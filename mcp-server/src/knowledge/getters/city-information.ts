/**
 * Utility functions for extracting city information from the game
 */

import { LuaFunction } from '../../bridge/lua-function.js';
import { CityInformation } from '../schema/timed.js';
import { knowledgeManager, gameDatabase } from '../../server.js';
import { createLogger } from '../../utils/logger.js';
import { Selectable } from 'kysely';

const logger = createLogger('CityInformation');

/**
 * Building relationship data structure
 */
interface BuildingRelationship {
  buildingClass: string;
  prerequisites: Set<string>;  // BuildingClass types this needs
  unlocks: Set<string>;        // BuildingClass types this unlocks
  prereqTech: string | null;   // Technology required to build
  techEra: string | null;      // Era of the prerequisite technology
}

// Module-level cache for building relationships
let buildingRelationshipCache: Map<string, BuildingRelationship> | null = null;
// Map from building description to building class
let descriptionToClassCache: Map<string, string> | null = null;

/**
 * Build comprehensive building relationship cache
 * Creates a unified cache with all building prerequisites and unlock relationships
 */
async function buildRelationshipCache(): Promise<void> {
  // Return if already cached
  if (buildingRelationshipCache !== null && descriptionToClassCache !== null) {
    return;
  }

  const db = gameDatabase.getDatabase();

  // Get all buildings with their classes and tech info (excluding wonders)
  const allBuildings = await db
    .selectFrom('Buildings as b')
    .innerJoin('BuildingClasses as bc', 'bc.Type', 'b.BuildingClass')
    .leftJoin('Technologies as t', 't.Type', 'b.PrereqTech')
    .select([
      'b.Type as BuildingType',
      'b.Description as BuildingDescription',
      'b.BuildingClass as BuildingClass',
      'b.PrereqTech as PrereqTech',
      't.Era as TechEra'
    ])
    .execute();

  // Get all prerequisite relationships (what each building needs)
  const prerequisites = await db
    .selectFrom('Building_ClassesNeededInCity')
    .select([
      'BuildingType',
      'BuildingClassType as PrerequisiteClass'
    ])
    .execute();

  // Initialize caches
  buildingRelationshipCache = new Map<string, BuildingRelationship>();
  descriptionToClassCache = new Map<string, string>();

  // Build description to class mapping and initialize relationship objects
  for (const building of allBuildings) {
    if (building.BuildingDescription && building.BuildingClass) {
      descriptionToClassCache.set(await gameDatabase.localize(building.BuildingDescription), building.BuildingClass);

      // Initialize relationship object if not exists
      if (!buildingRelationshipCache.has(building.BuildingClass)) {
        buildingRelationshipCache.set(building.BuildingClass, {
          buildingClass: building.BuildingClass,
          prerequisites: new Set<string>(),
          unlocks: new Set<string>(),
          prereqTech: building.PrereqTech,
          techEra: building.TechEra
        });
      }
    }
  }

  // Populate prerequisites and unlocks
  for (const prereq of prerequisites) {
    if (!prereq.BuildingType || !prereq.PrerequisiteClass) continue;

    // Find the building class for this building type
    const buildingInfo = allBuildings.find(b => b.BuildingType === prereq.BuildingType);
    if (!buildingInfo || !buildingInfo.BuildingClass) continue;

    // Add prerequisite to the building
    const relationship = buildingRelationshipCache.get(buildingInfo.BuildingClass);
    if (relationship) {
      relationship.prerequisites.add(prereq.PrerequisiteClass);
    }

    // Add this building as "unlocked by" the prerequisite
    const prereqRelationship = buildingRelationshipCache.get(prereq.PrerequisiteClass);
    if (prereqRelationship) {
      prereqRelationship.unlocks.add(buildingInfo.BuildingClass);
    }
  }

  logger.info(`Cached ${buildingRelationshipCache.size} building relationships and ${descriptionToClassCache.size} description mappings`);
}

/**
 * Filter buildings to show only the most advanced in each chain
 * Removes:
 * 1. Buildings that have no prereq tech
 * 2. Buildings that have prereq tech in ancient era AND have no unlocked buildings
 * 3. Buildings that are superseded (their unlocked buildings are in the list)
 */
async function filterBuildings(allBuildings: string[]): Promise<string[]> {
  if (!allBuildings || allBuildings.length === 0) return [];

  // Ensure cache is built
  await buildRelationshipCache();

  // Map building descriptions to their classes
  const buildingClassesInCity = new Set<string>();
  for (const buildingDesc of allBuildings) {
    const buildingClass = descriptionToClassCache!.get(buildingDesc);
    if (buildingClass) {
      buildingClassesInCity.add(buildingClass);
    }
  }

  // Filter buildings
  const filtered: string[] = [];

  for (const buildingDesc of allBuildings) {
    const buildingClass = descriptionToClassCache!.get(buildingDesc);
    if (!buildingClass) continue;
    const relationship = buildingRelationshipCache!.get(buildingClass);
    if (!relationship) continue;

    // Filter out buildings with no prereq tech
    if (!relationship.prereqTech) continue;
    // Filter out buildings with ancient era tech AND no unlocked buildings
    if (relationship.techEra === 'ERA_ANCIENT' && relationship.unlocks.size === 0) continue;
    // Check if this building is superseded (its unlocked buildings are in the city)
    let isSuperseded = false;
    for (const unlockedClass of relationship.unlocks) {
      if (buildingClassesInCity.has(unlockedClass)) {
        // This building unlocks something that's already in the city
        isSuperseded = true;
        break;
      }
    }

    if (!isSuperseded) {
      filtered.push(buildingDesc);
    }
  }

  return filtered;
}

/**
 * Lua function that extracts city information from the game
 */
let luaFuncInstance: LuaFunction | undefined;
/** Lazily constructed so the (file-reading) init runs on first use, not at import. */
const luaFunc = () => (luaFuncInstance ??= LuaFunction.fromFile(
  'get-city-information.lua',
  'getCityInformation',
  []
));

/**
 * Get all city information from the current game
 * Returns full city data with visibility-based access control
 * Also stores each city as mutable knowledge in the database
 * @returns Array of CityInformation objects for all cities
 */
export async function getCityInformations(): Promise<Selectable<CityInformation>[]> {
  const response = await luaFunc().execute();
  if (!response.success) {
    logger.error('Failed to get city information from Lua', response);
    return [];
  }

  const cities = response.result as Selectable<CityInformation>[];

  // Filter building lists to show only most advanced buildings
  for (const city of cities) {
    if (city.ImportantBuildings && Array.isArray(city.ImportantBuildings))
      city.ImportantBuildings = await filterBuildings(city.ImportantBuildings);
  }

  // Store all cities as mutable knowledge in batch
  try {
  // Visibility handled by Lua script
    await knowledgeManager.getStore().storeMutableKnowledgeBatch(
      'CityInformations',
      cities.map(city => ({
        key: city.Key,
        data: city as any
      }))
    );

    logger.info(`Stored ${cities.length} cities as mutable knowledge`);
  } catch (error) {
    logger.error('Failed to store city information as mutable knowledge', error);
    // Don't fail the function if storage fails - still return the cities
  }

  return cities;
}

