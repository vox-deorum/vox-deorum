/**
 * Utility functions for managing game identity and synchronization state
 * Uses BridgeManager to execute Lua scripts and interact with Civ V's save data
 */

import { LuaFunction } from '../../bridge/lua-function.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger("GameIdentity");

/**
 * Game identity information
 */
export interface GameIdentity {
  gameId: string;
  turn: number;
  activePlayerId?: number;
  timestamp?: number;
}

/**
 * Lua function that analyzes game identity
 */
let luaFuncInstance: LuaFunction | undefined;
/** Lazily constructed so the (file-reading) init runs on first use, not at import. */
const luaFunc = () => (luaFuncInstance ??= LuaFunction.fromFile(
  'game-identity.lua',
  'syncGameIdentity',
  ['time', 'uuid']
));

/**
 * Get or create a unique game ID for the current game session
 * Uses Civ V's Modding.OpenSaveData() to persist the ID
 * @returns The unique game ID and current turn number
 */
export async function syncGameIdentity(): Promise<GameIdentity | undefined> {
  const response = await luaFunc().execute(Date.now(), crypto.randomUUID());
  if (!response.success) {
    logger.warn("Sync identity failed!", response.error);
    return undefined;
  }
  if (!response.result) throw new Error("Lua serialization malfunctions!");
  return response.result as GameIdentity;
}