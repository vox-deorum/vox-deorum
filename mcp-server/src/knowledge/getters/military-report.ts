/**
 * Utility functions for extracting military report from the game
 * Includes unit types and tactical zones with unit assignments
 */

import { LuaFunction } from '../../bridge/lua-function.js';
import { knowledgeManager } from '../../server.js';
import { enumMappings } from '../../utils/knowledge/enum.js';
import { composeVisibility } from '../../utils/knowledge/visibility.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger("getMilitaryReport");

/**
 * Lua function that extracts military report from the game
 */
let luaFuncInstance: LuaFunction | undefined;
/** Lazily constructed so the (file-reading) init runs on first use, not at import. */
const luaFunc = () => (luaFuncInstance ??= LuaFunction.fromFile(
  'get-military-report.lua',
  'getMilitaryReport',
  ['playerID']
));

/**
 * Get military report for a specific player
 * Returns units organized by AI type and tactical zones with unit assignments
 * Saves tactical zone information to TacticalZones table
 * @param playerID - The player ID to get the report for
 * @param saving - Whether to save zone data to the database
 * @returns Military report with units and zones
 */
export async function getMilitaryReport(
  playerID: number,
  saving: boolean = true
): Promise<{ units: any; zones: any } | null> {
  const response = await luaFunc().execute(playerID);
  if (!response.success || !response.result || response.result.length < 2)
    return null;

  let [units, zones] = response.result;

  // Get enum mappings for post-processing
  const unitTypes = enumMappings["UnitType"];
  const aiTypes = enumMappings["AIType"];
  if (!unitTypes) logger.warn("UnitType enum does not exist!");
  if (!aiTypes) logger.warn("AIType enum does not exist!");

  // Convert numeric AI types and unit types to their string representations
  if (units) {
    const convertedUnits: Record<string, Record<string, unknown>> = {};

    for (const [aiTypeNum, unitsByType] of Object.entries(units)) {
      // Convert AI type enum to string
      const aiType = aiTypes?.[Number(aiTypeNum)] ?? `Unknown_${aiTypeNum}`;
      convertedUnits[aiType] = {};

      // Convert unit type IDs to their string representations
      for (const [unitTypeNum, unitData] of Object.entries(unitsByType as Record<string, unknown>)) {
        const unitType = unitTypes?.[Number(unitTypeNum)] ?? `Unknown_${unitTypeNum}`;
        convertedUnits[aiType][unitType] = unitData;
      }
    }

    units = convertedUnits;
  }

  // Convert unit types in zones
  if (zones) {
    for (const zone of Object.values(zones as Record<string, any>)) {
      if (zone.Units) {
        for (const civName in zone.Units) {
          const convertedUnits: Record<string, number> = {};
          for (const [unitTypeNum, count] of Object.entries(zone.Units[civName] as Record<string, number>)) {
            const unitType = unitTypes?.[Number(unitTypeNum)] ?? `Unknown_${unitTypeNum}`;
            convertedUnits[unitType] = count;
          }
          zone.Units[civName] = convertedUnits;
        }
      }
    }
  }

  const store = knowledgeManager.getStore();

  // Save tactical zone information with units in batch
  if (saving && zones) {
    // Convert zones object to array for batch processing
    const zoneItems = Object.entries(zones as Record<string, Record<string, unknown>>)
      .map(([_, zone]) => ({
        data: zone,
        extra: {
          PlayerID: playerID
        },
        visibilityFlags: composeVisibility([playerID])
      }));

    if (zoneItems.length > 0) {
      await store.storeTimedKnowledgeBatch('TacticalZones', zoneItems);
    }
  }

  return { units, zones };
}
