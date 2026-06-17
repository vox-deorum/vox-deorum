/**
 * Tests for the player-summary getter: the Lua boundary is stubbed and the era-name
 * mapping, quest parsing, and PlayerSummaries store-write path run for real against an
 * in-memory store. Visibility is carried on the Lua payload (Player<N> columns), so we
 * seed those and assert the per-player read filter honors them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../../helpers.js';
import { LuaFunction } from '../../../../src/bridge/lua-function.js';
import { getPlayerSummaries } from '../../../../src/knowledge/getters/player-summary.js';
import type { KnowledgeStore } from '../../../../src/knowledge/store.js';

let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupStore(10);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

/** Stub the Lua boundary to return canned summaries. */
function mockLua(result: unknown, success = true) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success, result } as any);
}

/** A summary with all not-null columns populated; visibility via Player<N> fields. */
const baseSummary = (key: number, overrides: Record<string, any> = {}) => ({
  Key: key,
  Era: 'ERA_MEDIEVAL',
  Cities: 3,
  Population: 12,
  Gold: 500,
  GoldPerTurn: 25.5,
  Technologies: 18,
  // Visibility carried on the payload (set by the Lua script in production).
  Player0: 2,
  Player1: 0,
  ...overrides,
});

describe('getPlayerSummaries', () => {
  it('returns an empty array when the Lua call fails', async () => {
    mockLua(undefined, false);
    expect(await getPlayerSummaries()).toEqual([]);
  });

  it('maps the era enum and persists per-player honoring carried visibility', async () => {
    mockLua([baseSummary(0)]);

    const result = await getPlayerSummaries();
    expect(result[0].Era).toBe('Medieval');

    // Persisted as mutable knowledge under the summary's Key.
    const stored = await store.getMutableKnowledge('PlayerSummaries', 0);
    expect(stored).toMatchObject({ Key: 0, Era: 'Medieval', Cities: 3, Turn: 10 });

    // Visibility carried on the payload: visible to player 0, not player 1.
    expect(await store.getMutableKnowledge('PlayerSummaries', 0, 0)).toBeTruthy();
    expect(await store.getMutableKnowledge('PlayerSummaries', 0, 1)).toBeFalsy();
  });

  it('parses [NEWLINE]-separated quest strings into grouped quest arrays', async () => {
    const summary = baseSummary(0, {
      Quests: {
        CityState1:
          'Global Quests:[NEWLINE]* Build a Wonder[NEWLINE]Reward is gold[NEWLINE]* Bully a City-State[NEWLINE]Reward is influence',
      },
    });
    mockLua([summary]);

    const result = await getPlayerSummaries();
    const quests = (result[0].Quests as any).CityState1 as string[];
    // The "Global Quests:" header line is stripped; each transition from a "*" line to a
    // non-"*" line flushes a quest block. The first "*" line accumulates a leading space.
    expect(quests).toEqual([
      ' * Build a Wonder',
      'Reward is gold * Bully a City-State',
      'Reward is influence',
    ]);
  });

  it('stores each player summary under its own key', async () => {
    mockLua([
      baseSummary(0, { Era: 'ERA_ANCIENT' }),
      baseSummary(5, { Era: 'ERA_MODERN', Player0: 0, Player5: 2 }),
    ]);

    await getPlayerSummaries();
    expect((await store.getMutableKnowledge('PlayerSummaries', 0))!.Era).toBe('Ancient');
    expect((await store.getMutableKnowledge('PlayerSummaries', 5))!.Era).toBe('Modern');
  });

  it('does not write to the store when saving=false', async () => {
    mockLua([baseSummary(0)]);
    const result = await getPlayerSummaries(false);
    expect(result[0].Era).toBe('Medieval');
    expect(await store.getMutableKnowledge('PlayerSummaries', 0)).toBeUndefined();
  });
});
