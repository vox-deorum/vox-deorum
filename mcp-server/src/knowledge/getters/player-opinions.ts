/**
 * Lua-based player opinion analyzer
 * Retrieves diplomatic opinions between players and saves them to the database
 */

import { Selectable } from 'kysely';
import { LuaFunction } from '../../bridge/lua-function.js';
import { PlayerOpinions } from '../schema/timed.js';
import { knowledgeManager } from '../../server.js';
import { stripTags } from '../../utils/database/localized.js';
import { composeVisibility } from '../../utils/knowledge/visibility.js';

/**
 * Lua function that retrieves player opinions to all major civs
 */
let getPlayerOpinionsFuncInstance: LuaFunction | undefined;
/** Lazily constructed so the (file-reading) init runs on first use, not at import. */
const getPlayerOpinionsFunc = () => (getPlayerOpinionsFuncInstance ??= LuaFunction.fromFile(
  'get-player-opinions.lua',
  'getAllPlayerOpinions',
  ['firstPlayer']
));


/**
 * Get diplomatic opinions from one player to and from all other major civilizations and optionally save
 * @param firstPlayer The ID of the player whose opinions to retrieve
 * @param saving Whether to save the opinions to the database (default: true)
 * @returns PlayerOpinions object with opinions populated, or undefined on error
 */
export async function getPlayerOpinions(firstPlayer?: number, saving: boolean = true): Promise<Partial<Selectable<PlayerOpinions>> | undefined> {
  if (firstPlayer === undefined) return undefined;
  const response = await getPlayerOpinionsFunc().execute(firstPlayer);
  if (!response.success || typeof response.result !== 'object') {
    return undefined;
  }
  
  // Build PlayerOpinions object
  const playerOpinion: Partial<Selectable<PlayerOpinions>> = {
    Key: firstPlayer
  };
  
  // Process opinions and populate fields
  for (const [targetId, opinionList] of Object.entries(response.result)) {
    if (Array.isArray(opinionList)) {
      const opinionFrom = opinionList[0]?.join('\n');
      const opinionTo = opinionList[1]?.join('\n');
      (playerOpinion as any)[`OpinionFrom${targetId}`] = stripTags(opinionFrom);
      (playerOpinion as any)[`OpinionTo${targetId}`] = stripTags(opinionTo);
    }
  }
  
  // Save to database if enabled
  if (saving) {
    const store = knowledgeManager.getStore();
    await store.storeMutableKnowledge(
      'PlayerOpinions',
      firstPlayer,
      playerOpinion,
      composeVisibility([firstPlayer]),
    );
  }
  
  return playerOpinion;
}