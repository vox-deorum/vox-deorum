/**
 * Utility functions for extracting player summary information from the game
 */

import { Selectable } from 'kysely';
import { LuaFunction } from '../../bridge/lua-function.js';
import { PlayerSummary, DiplomaticDealDetails } from '../schema/timed.js';
import { getEraName } from '../../utils/database/enums.js';
import { knowledgeManager } from '../../server.js';
import { stripTags } from '../../utils/database/localized.js';

/**
 * Lua function that extracts player summary information from the game
 */
let luaFuncInstance: LuaFunction | undefined;
/** Lazily constructed so the (file-reading) init runs on first use, not at import. */
const luaFunc = () => (luaFuncInstance ??= LuaFunction.fromFile(
  'get-player-summary.lua',
  'getPlayerSummary',
  []
));

/**
 * Get all player summary information from the current game
 * Returns summary data for all active players (major civs, minor civs)
 * @returns Array of PlayerSummary objects for all active players
 */
export async function getPlayerSummaries(saving: boolean = true): Promise<Selectable<PlayerSummary>[]> {
  const response = await luaFunc().execute();
  if (!response.success)
    return [];
  const store = knowledgeManager.getStore();

  // Process all summaries
  for (const summary of response.result) {
    // Era names
    summary.Era = getEraName(summary.Era);
    // Quests
    if (summary.Quests) {
      for (const key of Object.keys(summary.Quests)) {
        const questLines = (summary.Quests[key] as string)
          .split("[NEWLINE]")
          .filter(line => line)
          .map(line => stripTags(line)
            .replace(/^(Global Quests:|Personal Quests:|Other Information:)\s*/i, "")
            .trim())
          .filter(line => line !== "");
        const quests: string[] = [];
        let currentQuest = "";
        let seenAsterick = false;
        for (const line of questLines) {
          const asterick = line.startsWith("*");
          if (!asterick && seenAsterick) {
            quests.push(currentQuest);
            currentQuest = line;
          } else {
            currentQuest += " " + line;
          }
          seenAsterick = asterick;
        }
        if (currentQuest !== "")
          quests.push(currentQuest);
        summary.Quests[key] = quests;
      }
    }

    // Diplomatic deals: permanent deals arrive from Lua with the -1 sentinel (and an
    // already-expired term can compute to 0 or less). Drop TurnsRemaining unless it is a
    // positive countdown so no consumer ever frames a negative or zero term.
    if (summary.DiplomaticDeals) {
      for (const deals of Object.values(summary.DiplomaticDeals) as DiplomaticDealDetails[][]) {
        for (const deal of deals) {
          if (deal.TurnsRemaining !== undefined && deal.TurnsRemaining <= 0)
            delete deal.TurnsRemaining;
        }
      }
    }
  }

  // Store all summaries in batch if saving is enabled
  // Visibility handled by Lua script
  if (saving) {
    await store.storeMutableKnowledgeBatch(
      'PlayerSummaries',
      response.result.map((summary: any) => {
        return {
          key: summary.Key!,
          data: summary
        }})
    );
  }

  return response.result;
}