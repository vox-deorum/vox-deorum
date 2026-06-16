/**
 * Shared fixture for the diplomacy transcript tool tests. Stands up a real KnowledgeStore
 * backed by an in-memory SQLite database and points the `knowledgeManager` singleton at it,
 * so the append-message / read-transcript tools run their real store path with no
 * bridge-service, DLL, or live game.
 */

import { vi } from 'vitest';
import { KnowledgeStore } from '../../../src/knowledge/store.js';
import { knowledgeManager } from '../../../src/server.js';

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
export async function setupDiplomacyStore(turn = 10): Promise<KnowledgeStore> {
  const store = new KnowledgeStore();
  await store.initialize(':memory:', 'test');
  vi.spyOn(knowledgeManager, 'getStore').mockReturnValue(store);
  vi.spyOn(knowledgeManager, 'getTurn').mockReturnValue(turn);
  return store;
}

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
