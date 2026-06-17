/**
 * Utility functions for extracting victory progress from the game
 * Includes domination, science, cultural, and diplomatic victory tracking
 */

import { Selectable } from 'kysely';
import { LuaFunction } from '../../bridge/lua-function.js';
import { VictoryProgress } from '../schema/timed.js';
import { knowledgeManager } from '../../server.js';
import { stripTags } from '../../utils/database/localized.js';

/**
 * Lua function that extracts victory progress information from the game
 */
let luaFuncInstance: LuaFunction | undefined;
/** Lazily constructed so the (file-reading) init runs on first use, not at import. */
const luaFunc = () => (luaFuncInstance ??= LuaFunction.fromFile(
  'get-victory-progress.lua',
  'getVictoryProgress',
  []
));

/**
 * Get victory progress from the current game
 * Returns a single global victory progress object for all victory types
 * Visible to all players (global knowledge) - Key is always 0
 * @returns A single VictoryProgress object
 */
export async function getVictoryProgress(saving: boolean = true): Promise<Partial<Selectable<VictoryProgress>> | null> {
  const response = await luaFunc().execute();
  if (!response.success || !response.result || response.result.length === 0)
    return null;

  const store = knowledgeManager.getStore();
  const victoryData = response.result[0];

  // Helper to strip localization markers from resolution/proposal objects
  const stripTagsFromItems = (items: Record<string, any>) => {
    const stripped: Record<string, any> = {};
    for (const name in items) {
      const item = items[name];
      const strippedName = stripTags(name);
      stripped[strippedName] = {
        ...item,
        Description: stripTags(item.Description)
      };
    }
    return stripped;
  };

  // Strip localization markers from diplomatic victory data
  if (victoryData.DiplomaticVictory) {
    if (victoryData.DiplomaticVictory.ActiveResolutions) {
      victoryData.DiplomaticVictory.ActiveResolutions =
        stripTagsFromItems(victoryData.DiplomaticVictory.ActiveResolutions);
    }
    if (victoryData.DiplomaticVictory.Proposals) {
      victoryData.DiplomaticVictory.Proposals =
        stripTagsFromItems(victoryData.DiplomaticVictory.Proposals);
    }
  }

  // Store the victory progress if saving is enabled (always use Key = 0)
  if (saving) {
    // Visible to all players (constrained by visibility for player's identity)
    await store.storeMutableKnowledge(
      'VictoryProgress',
      0,  // Key is always 0 for global victory progress
      victoryData,
    );
  }

  return victoryData;
}
