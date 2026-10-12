import { gameDatabase } from "../../server.js";
import { DatabaseQueryTool } from "../abstract/database-query.js";
import * as z from "zod";
import { getEraName } from "../../utils/database/enums.js";

/**
 * Schema for building summary information
 */
const BuildingSummarySchema = z.object({
  Type: z.string(),
  Name: z.string(),
  Help: z.string(),
  Cost: z.number(),
  PrereqTech: z.string().nullable(),
  Era: z.string().nullable(),
  UniqueOf: z.string().nullable()
});

/**
 * Schema for full building information including relations
 */
const BuildingReportSchema = BuildingSummarySchema.extend({
  Strategy: z.string().nullable(),
  Class: z.string(),
  PrereqBuildings: z.array(z.string()),
  IsNationalWonder: z.boolean(),
  IsWorldWonder: z.boolean(),
  Happiness: z.number(),
  Defense: z.number(),
  HP: z.number(),
  Maintenance: z.number()
});

type BuildingSummary = z.infer<typeof BuildingSummarySchema>;
type BuildingReport = z.infer<typeof BuildingReportSchema>;

/**
 * Tool for querying building information from the game database
 */
class GetBuildingTool extends DatabaseQueryTool<BuildingSummary, BuildingReport> {
  /**
   * Unique identifier for the get building tool
   */
  readonly name = "get-building";

  /**
   * Human-readable description of the get building tool
   */
  readonly description = "Retrieves building information from the Civilization V game database with listing and fuzzy search capabilities";

  /**
   * Schema for building summary
   */
  protected readonly summarySchema = BuildingSummarySchema;

  /**
   * Schema for full building information
   */
  protected readonly fullSchema = BuildingReportSchema;

  /**
   * Full reports carry the in-game building tooltip
   */
  protected readonly tooltipKind = 'building';

  /**
   * Fetch building summaries from database
   */
  protected async fetchSummaries(): Promise<BuildingSummary[]> {
    const summaries = await gameDatabase.getDatabase()
      .selectFrom("Buildings as b")
      .leftJoin("Technologies as t", "b.PrereqTech", "t.Type")
      .leftJoin("Civilization_BuildingClassOverrides as cbo", "cbo.BuildingType", "b.Type")
      .leftJoin("Civilizations as c", "c.Type", "cbo.CivilizationType")
      .leftJoin("Eras as e", "t.Era", "e.Type")
      .select([
        'b.Type', 
        'b.Description as Name', 
        'b.Help', 
        'b.Cost', 
        't.Description as PrereqTech',
        'c.ShortDescription as UniqueOf',
        'e.Type as Era'
      ])
      .execute() as BuildingSummary[];
    summaries.forEach(p => {
      p.Help = p.Help ?? '';
      p.Era = getEraName(p.Era) ?? null;
    });
    return summaries;
  }
  
  protected fetchFullInfo = getBuilding;
}

/**
 * Creates a new instance of the get building tool
 */
export default function createGetBuildingTool() {
  return new GetBuildingTool();
}

/**
 * Fetch full building information for a specific building
 */
export async function getBuilding(buildingType: string) {
  // Fetch base building info with technology name, era, and unique civilization
  const db = gameDatabase.getDatabase();
  const building = await db
    .selectFrom('Buildings as b')
    .leftJoin('Technologies as t', 'b.PrereqTech', 't.Type')
    .leftJoin('Eras as e', 't.Era', 'e.Type')
    .leftJoin('Civilization_BuildingClassOverrides as cbo', 'cbo.BuildingType', 'b.Type')
    .leftJoin('Civilizations as c', 'c.Type', 'cbo.CivilizationType')
    .selectAll('b')
    .select(['t.Description as PrereqTechName', 'c.ShortDescription as UniqueCivName', 'e.Type as EraType'])
    .where('b.Type', '=', buildingType)
    .executeTakeFirst();
  
  if (!building) {
    throw new Error(`Building ${buildingType} not found`);
  }
  
  // Get building class info
  const buildingClass = await db
    .selectFrom('BuildingClasses')
    .selectAll()
    .where('Type', '=', building.BuildingClass)
    .executeTakeFirst();
  
  // Get prerequisite buildings
  const prereqBuildings = await db
    .selectFrom('Building_ClassesNeededInCity')
    .select('BuildingClassType')
    .innerJoin('BuildingClasses as bc', 'bc.Type', 'BuildingClassType')
    .select('bc.Description')
    .where('BuildingType', '=', buildingType)
    .execute();
  
  // Determine if it's a wonder
  const isNationalWonder = buildingClass?.MaxPlayerInstances === 1;
  const isWorldWonder = buildingClass?.MaxGlobalInstances === 1;
  
  // Construct the full building object
  return {
    Type: building.Type,
    Name: building.Description || '',
    Help: building.Help || '',
    Cost: building.Cost || 0,
    PrereqTech: building.PrereqTechName || null,
    Era: getEraName(building?.EraType) || null,
    Strategy: building.Strategy,
    Class: building.BuildingClass || '',
    PrereqBuildings: prereqBuildings.map(p => p.Description || ''),
    IsNationalWonder: isNationalWonder || false,
    IsWorldWonder: isWorldWonder || false,
    Happiness: building.Happiness || 0,
    Defense: building.Defense || 0,
    HP: building.ExtraCityHitPoints || 0,
    Maintenance: building.GoldMaintenance || 0,
    UniqueOf: building.UniqueCivName || null
  };
}
