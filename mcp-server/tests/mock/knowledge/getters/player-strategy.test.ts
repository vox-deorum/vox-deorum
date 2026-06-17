/**
 * Tests for the player-strategy getter: the Lua boundary (readPlayerStrategies) is
 * stubbed and the enum-name conversion + StrategyChanges store-write path runs for
 * real against an in-memory KnowledgeStore.
 *
 * Strategy enum maps are normally loaded from the game DB at runtime; the mock tier has
 * no DB, so we inject them into `enumMappings` directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../../helpers.js';
import { LuaFunction } from '../../../../src/bridge/lua-function.js';
import { enumMappings } from '../../../../src/utils/knowledge/enum.js';
import { getPlayerStrategy } from '../../../../src/knowledge/getters/player-strategy.js';
import type { KnowledgeStore } from '../../../../src/knowledge/store.js';

let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupStore(10);
  enumMappings.GrandStrategy = { 1: 'Conquest', 2: 'Culture' };
  enumMappings.EconomicStrategy = { 10: 'Growth', 11: 'Trade' };
  enumMappings.MilitaryStrategy = { 20: 'War', 21: 'Defense' };
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete (enumMappings as any).GrandStrategy;
  delete (enumMappings as any).EconomicStrategy;
  delete (enumMappings as any).MilitaryStrategy;
  await store.close();
});

/** Stub the Lua boundary to return canned current strategies. */
function mockLua(result: unknown, success = true) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
    success,
    result,
  } as any);
}

describe('getPlayerStrategy', () => {
  it('returns null when the Lua call fails', async () => {
    mockLua(undefined, false);
    expect(await getPlayerStrategy(0)).toBeNull();
    // Nothing persisted on failure.
    expect(await store.getMutableKnowledgeHistory('StrategyChanges', 0)).toHaveLength(0);
  });

  it('converts numeric IDs to sorted names and persists with player visibility', async () => {
    mockLua({
      GrandStrategy: 1,
      EconomicStrategies: [11, 10],
      MilitaryStrategies: [20],
    });

    const result = await getPlayerStrategy(0);
    expect(result).toMatchObject({
      GrandStrategy: 'Conquest',
      EconomicStrategies: ['Growth', 'Trade'], // sorted alphabetically
      MilitaryStrategies: ['War'],
    });

    // Persisted as mutable knowledge, visible to player 0 only.
    const stored = await store.getMutableKnowledge('StrategyChanges', 0, 0);
    expect(stored).toMatchObject({
      Key: 0,
      GrandStrategy: 'Conquest',
      EconomicStrategies: ['Growth', 'Trade'],
      MilitaryStrategies: ['War'],
      Turn: 10,
    });
    expect(await store.getMutableKnowledge('StrategyChanges', 0, 1)).toBeUndefined();
  });

  it('normalizes empty Lua tables (objects) into empty arrays', async () => {
    mockLua({
      GrandStrategy: 2,
      EconomicStrategies: {},
      MilitaryStrategies: {},
    });

    const result = await getPlayerStrategy(3);
    expect(result).toMatchObject({
      GrandStrategy: 'Culture',
      EconomicStrategies: [],
      MilitaryStrategies: [],
    });

    const stored = await store.getMutableKnowledge('StrategyChanges', 3, 3);
    expect(stored).toMatchObject({ EconomicStrategies: [], MilitaryStrategies: [] });
  });

  it('seeds the In-Game AI rationale wrapper and reuses it on re-read', async () => {
    mockLua({ GrandStrategy: 1, EconomicStrategies: [], MilitaryStrategies: [] });

    await getPlayerStrategy(0);
    const first = await store.getMutableKnowledge('StrategyChanges', 0, 0);
    // First write: prior rationale "Unknown" gets wrapped.
    expect(first!.Rationale).toBe('Tweaked by In-Game AI(Unknown)');

    // A second read that produces a real change keeps the already-wrapped rationale
    // rather than double-wrapping it.
    mockLua({ GrandStrategy: 2, EconomicStrategies: [], MilitaryStrategies: [] });
    await getPlayerStrategy(0);
    const latest = await store.getMutableKnowledge('StrategyChanges', 0, 0);
    expect(latest!.GrandStrategy).toBe('Culture');
    expect(latest!.Rationale).toBe('Tweaked by In-Game AI(Unknown)');
  });
});
