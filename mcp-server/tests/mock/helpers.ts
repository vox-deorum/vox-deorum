/**
 * Shared mock-tier fixtures for mcp-server store / getter / action tests.
 *
 * Stands up a real KnowledgeStore backed by an in-memory SQLite database and points the
 * `knowledgeManager` singleton at it, so tools and getters run their real store path with
 * no bridge-service, DLL, or live game. Originally written for the diplomacy transcript
 * tests; promoted here so the rest of the store/getter/action coverage can build on it.
 */

import { vi } from 'vitest';
import { LuaFunction } from '../../src/bridge/lua-function.js';
import { KnowledgeStore } from '../../src/knowledge/store.js';
import { knowledgeManager } from '../../src/server.js';

export interface SeedPlayerOptions {
  civilization?: string;
  leader?: string;
  teamID?: number;
  isHuman?: number;
  isMajor?: number;
}

/**
 * Create an in-memory KnowledgeStore (with the full schema) and redirect
 * `knowledgeManager.getStore()` / `getTurn()` to it. Returns the store for seeding/reads.
 */
export async function setupStore(turn = 10): Promise<KnowledgeStore> {
  const store = new KnowledgeStore();
  await store.initialize(':memory:', 'test');
  vi.spyOn(knowledgeManager, 'getStore').mockReturnValue(store);
  vi.spyOn(knowledgeManager, 'getTurn').mockReturnValue(turn);
  return store;
}

/** Back-compat alias for the original diplomacy fixture name. */
export const setupDiplomacyStore = setupStore;

/** Seed one PlayerInformations row (major by default) so the cached major-civ check has data. */
export async function seedPlayer(store: KnowledgeStore, key: number, opts: SeedPlayerOptions = {}): Promise<void> {
  await store.storePublicKnowledge('PlayerInformations', key, {
    Civilization: opts.civilization ?? `Civ${key}`,
    Leader: opts.leader ?? `Leader${key}`,
    TeamID: opts.teamID ?? key,
    IsHuman: opts.isHuman ?? 0,
    IsMajor: opts.isMajor ?? 1,
  } as any);
}

/** One player action push as the registerAction Lua function receives it. */
export interface ActionPush {
  playerID: number;
  actionType: string;
  summary: string;
  rationale: string;
  /** Undefined when the action adds no replay message. */
  replayPrefix?: string;
  turn: number;
}

/**
 * Read the player action pushes sent through a mocked `LuaFunction.prototype.execute`.
 * Pushes call the same Lua boundary as the tool itself, under the registerAction name.
 */
export function actionPushes(): ActionPush[] {
  const execute = vi.mocked(LuaFunction.prototype.execute);
  if (!vi.isMockFunction(execute)) throw new Error('Mock LuaFunction.prototype.execute before reading action pushes');
  return execute.mock.calls.flatMap((args, index) => {
    if ((execute.mock.contexts[index] as LuaFunction).name !== 'registerAction') return [];
    const [playerID, actionType, summary, rationale, replayPrefix, turn] = args as [number, string, string, string, string | false, number];
    return [{ playerID, actionType, summary, rationale, replayPrefix: replayPrefix === false ? undefined : replayPrefix, turn }];
  });
}
