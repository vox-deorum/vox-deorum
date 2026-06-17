/**
 * Utility functions for extracting player information from the game
 */

import { Selectable } from 'kysely';
import { LuaFunction } from '../../bridge/lua-function.js';
import { PlayerInformation } from '../schema/public.js';
import { knowledgeManager } from '../../server.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('PlayerInformation');

/**
 * Lua function that extracts player information from the game
 */
let luaFuncInstance: LuaFunction | undefined;
/** Lazily constructed so the (file-reading) init runs on first use, not at import. */
const luaFunc = () => (luaFuncInstance ??= LuaFunction.fromFile(
  'get-player-information.lua',
  'getPlayerInformation',
  []
));

/**
 * Get all player information from the current game and store it
 * Filters out players not actually in the game (empty slots)
 * @param saving - Whether to store the information in the database (default: true)
 * @returns Array of PlayerInformation objects for all active players
 */
export async function getPlayerInformations(saving: boolean = true): Promise<Selectable<PlayerInformation>[]> {
  const response = await luaFunc().execute();
  if (!response.success) {
    return [];
  }

  const players = response.result as Selectable<PlayerInformation>[];

  // Store each player's information in the PlayerInformation table
  if (saving) {
    const store = knowledgeManager.getStore();
    for (const player of players) {
      await store.storePublicKnowledge('PlayerInformations', player.Key, player);
    }
    logger.info(`Stored player information for ${players.length} players`);
  }

  return players;
}