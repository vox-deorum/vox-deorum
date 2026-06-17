/**
 * Utility functions for extracting player strategic options from the game
 * Includes available technologies, policies, and strategies
 */

import { Selectable } from 'kysely';
import { LuaFunction } from '../../bridge/lua-function.js';
import { PlayerOptions } from '../schema/timed.js';
import { knowledgeManager } from '../../server.js';
import { retrieveEnumName } from '../../utils/knowledge/enum.js';
import { composeVisibility } from '../../utils/knowledge/visibility.js';

/**
 * Lua function that extracts player options information from the game
 */
let luaFuncInstance: LuaFunction | undefined;
/** Lazily constructed so the (file-reading) init runs on first use, not at import. */
const luaFunc = () => (luaFuncInstance ??= LuaFunction.fromFile(
  'get-player-options.lua',
  'getPlayerOptions',
  []
));

/**
 * Convert array of IDs to localized names using the appropriate enum
 */
function convertToNames(ids: number[] | undefined, enumType: string, alternateEnumType?: string): string[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .map(id => {
      const name = retrieveEnumName(enumType, id);
      return name || (alternateEnumType ? retrieveEnumName(alternateEnumType, id) : undefined);
    })
    .filter(name => name !== undefined) as string[];
}

/**
 * Convert a single ID to localized name
 */
function convertToName(id: number | null | undefined, enumType: string): string | null {
  if (id === null || id === undefined) return null;
  return retrieveEnumName(enumType, id) || null;
}

/**
 * Get all player options from the current game
 * Returns strategic options for all active players (technologies, policies, strategies)
 * Note: Each player can only see their own options due to visibility constraints
 * @returns Array of PlayerOptions objects for all active players
 */
export async function getPlayerOptions(saving: boolean = true): Promise<Partial<Selectable<PlayerOptions>>[]> {
  const response = await luaFunc().execute();
  if (!response.success)
    return [];
  const store = knowledgeManager.getStore();

  // Process and convert numeric IDs to names for all options
  // Note: Strategy blacklisting is now handled in CvLuaPlayer.cpp
  const processedResults = (response.result as any[]).map((options: any) => {
    return {
      PlayerID: options.PlayerID,
      EconomicStrategies: convertToNames(options.EconomicStrategies, "EconomicStrategy", "MilitaryStrategy"),
      MilitaryStrategies: convertToNames(options.MilitaryStrategies, "MilitaryStrategy", "EconomicStrategy"),
      Technologies: convertToNames(options.Technologies, "TechID"),
      NextResearch: convertToName(options.NextResearch, "TechID"),
      Policies: convertToNames(options.Policies, "PolicyID"),
      PolicyBranches: convertToNames(options.PolicyBranches, "BranchType"),
      NextPolicy: convertToName(options.NextPolicy, "PolicyID"),
      NextBranch: convertToName(options.NextBranch, "BranchType")
    };
  });

  // Store all options in batch if saving is enabled
  if (saving) await store.storeTimedKnowledgeBatch(
    'PlayerOptions',
    processedResults.map((options: any) => {
      return { 
        data: options,
        visibilityFlags: composeVisibility([options.PlayerID])
      };
    })
  );

  return processedResults;
}