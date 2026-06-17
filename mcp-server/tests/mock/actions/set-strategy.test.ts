/**
 * Tests for the set-strategy action tool. The Lua boundary is stubbed (no bridge); the
 * post-processing — array/object normalization, rationale wrapping, enum name<->id
 * resolution, change detection / replay push, and the StrategyChanges store writes —
 * runs for real against an in-memory KnowledgeStore.
 *
 * Strategy enum maps are normally loaded from the game DB at runtime; the mock tier has
 * no DB, so we inject them into `enumMappings` directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import { enumMappings } from '../../../src/utils/knowledge/enum.js';
import * as playerActions from '../../../src/utils/lua/player-actions.js';
import createSetStrategyTool from '../../../src/tools/actions/set-strategy.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createSetStrategyTool();
let store: KnowledgeStore;
let pushSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  store = await setupStore(10);
  enumMappings.GrandStrategy = { 1: 'Conquest', 2: 'Culture' };
  enumMappings.EconomicStrategy = { 10: 'Growth', 11: 'Trade' };
  enumMappings.MilitaryStrategy = { 20: 'War', 21: 'Defense' };
  pushSpy = vi.spyOn(playerActions, 'pushPlayerAction').mockResolvedValue();
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete (enumMappings as any).GrandStrategy;
  delete (enumMappings as any).EconomicStrategy;
  delete (enumMappings as any).MilitaryStrategy;
  await store.close();
});

/** Stub the Lua boundary so super.call() returns a canned "previous strategies" result. */
function mockLua(previous: {
  Changed?: boolean;
  GrandStrategy: number;
  EconomicStrategies: number[] | Record<string, number>;
  MilitaryStrategies: number[] | Record<string, number>;
}) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
    success: true,
    result: { Changed: true, ...previous },
  } as any);
}

describe('set-strategy', () => {
  it('resolves enum names, writes before/after versions, and pushes a replay action', async () => {
    mockLua({ GrandStrategy: 1, EconomicStrategies: {}, MilitaryStrategies: [20] });

    await tool.execute({
      PlayerID: 0,
      GrandStrategy: 'Culture',
      EconomicStrategies: ['Trade'],
      MilitaryStrategies: ['Defense'],
      Rationale: 'Switch to wide',
    } as any);

    const history = await store.getMutableKnowledgeHistory('StrategyChanges', 0);
    expect(history.map((h) => h.Version)).toEqual([2, 1]);

    // v1 = previous strategies, rationale wrapped as "Tweaked by In-Game AI(...)".
    const previous = history.find((h) => h.Version === 1)!;
    expect(previous.Rationale).toMatch(/^Tweaked by In-Game AI\(/);
    expect(previous.GrandStrategy).toBe('Conquest');
    expect(previous.EconomicStrategies).toEqual([]); // empty object normalized to []
    expect(previous.MilitaryStrategies).toEqual(['War']);

    // v2 = the new (resolved) strategies + the trimmed caller rationale.
    const latest = history.find((h) => h.Version === 2)!;
    expect(latest.GrandStrategy).toBe('Culture');
    expect(latest.EconomicStrategies).toEqual(['Trade']);
    expect(latest.MilitaryStrategies).toEqual(['Defense']);
    expect(latest.Rationale).toBe('Switch to wide');
    expect(latest.Turn).toBe(10);

    // Replay push fired for the strategy change with the "Strategies" prefix.
    expect(pushSpy).toHaveBeenCalledTimes(1);
    const [playerID, actionType, summary, rationale, prefix] = pushSpy.mock.calls[0];
    expect(playerID).toBe(0);
    expect(actionType).toBe('strategy');
    expect(prefix).toBe('Strategies');
    expect(rationale).toBe('Switch to wide');
    expect(summary).toContain('GrandStrategy: Conquest → Culture');
  });

  it('normalizes an object-shaped Lua strategy list into a sorted name array', async () => {
    mockLua({ GrandStrategy: 1, EconomicStrategies: { '0': 11, '1': 10 }, MilitaryStrategies: {} });

    await tool.execute({ PlayerID: 3, Rationale: 'noop' } as any);

    const previous = (await store.getMutableKnowledgeHistory('StrategyChanges', 3)).find((h) => h.Version === 1)!;
    // Object values [11,10] -> names -> sorted alphabetically.
    expect(previous.EconomicStrategies).toEqual(['Growth', 'Trade']);
  });

  it('writes StrategyChanges visible only to the acting player', async () => {
    mockLua({ GrandStrategy: 1, EconomicStrategies: [], MilitaryStrategies: [] });

    await tool.execute({ PlayerID: 0, GrandStrategy: 'Culture', Rationale: 'r' } as any);

    expect(await store.getMutableKnowledge('StrategyChanges', 0, 0)).not.toBeUndefined();
    expect(await store.getMutableKnowledge('StrategyChanges', 0, 1)).toBeUndefined();
  });

  it('does no store write or push when the Lua call fails', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success: false } as any);

    const result = await tool.execute({ PlayerID: 0, GrandStrategy: 'Culture', Rationale: 'r' } as any);
    expect(result.Success).toBe(false);
    expect(await store.getMutableKnowledgeHistory('StrategyChanges', 0)).toHaveLength(0);
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
