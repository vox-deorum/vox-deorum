/**
 * Tests for the set-strategy action tool. The Lua boundary is stubbed (no bridge); the
 * post-processing (array/object normalization, enum name<->id resolution, the
 * StrategyChanges store writes, and the replay push) runs for real against an
 * in-memory KnowledgeStore.
 *
 * Strategy enum maps are normally loaded from the game DB at runtime; the mock tier has
 * no DB, so we inject them into `enumMappings` directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore, actionPushes } from '../helpers.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import { enumMappings } from '../../../src/utils/knowledge/enum.js';
import createSetStrategyTool from '../../../src/tools/actions/set-strategy.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { connectToolClient } from '../tool-client.js';

const tool = createSetStrategyTool();
let store: KnowledgeStore;
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  store = await setupStore(10);
  enumMappings.GrandStrategy = { 1: 'Conquest', 2: 'Culture' };
  enumMappings.EconomicStrategy = { 10: 'Growth', 11: 'Trade' };
  enumMappings.MilitaryStrategy = { 20: 'War', 21: 'Defense' };
  client = await connectToolClient(tool);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await client.close();
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
  it.each([
    { label: 'omitted', turn: undefined, expected: 10 },
    { label: 'sentinel', turn: -1, expected: 10 },
    { label: 'zero', turn: 0, expected: 0 },
    { label: 'positive', turn: 7, expected: 7 },
  ])('records the $label source turn through MCP', async ({ turn, expected }) => {
    mockLua({ GrandStrategy: 1, EconomicStrategies: [], MilitaryStrategies: [] });
    const args: Record<string, unknown> = { PlayerID: 0, Rationale: 'Track source turn' };
    if (turn !== undefined) args.Turn = turn;

    const result = await client.call(args);

    expect(result.Success).toBe(true);
    expect((await store.getMutableKnowledge('StrategyChanges', 0))?.Turn).toBe(expected);
  });

  it('resolves enum names, records before/after strategy snapshots, and pushes a replay action', async () => {
    mockLua({ GrandStrategy: 1, EconomicStrategies: {}, MilitaryStrategies: [20] });

    await client.call({
      PlayerID: 0,
      GrandStrategy: 'Culture',
      EconomicStrategies: ['Trade'],
      MilitaryStrategies: ['Defense'],
      Rationale: 'Switch to wide',
    });

    const history = await store.getMutableKnowledgeHistory('StrategyChanges', 0);
    expect(history.map((h) => h.Version)).toEqual([2, 1]);

    // v1 = the previous strategy values.
    const previous = history.find((h) => h.Version === 1)!;
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

    const pushes = actionPushes();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ playerID: 0, actionType: 'strategy', replayPrefix: 'Strategies', rationale: 'Switch to wide', turn: 10 });
    expect(pushes[0].summary).toContain('Conquest');
    expect(pushes[0].summary).toContain('Culture');
  });

  it('pushes no replay action when the strategies are unchanged', async () => {
    mockLua({ GrandStrategy: 2, EconomicStrategies: [11], MilitaryStrategies: [21] });

    await client.call({ PlayerID: 0, GrandStrategy: 'Culture', EconomicStrategies: ['Trade'], MilitaryStrategies: ['Defense'], Rationale: 'Hold' });

    expect(actionPushes()).toHaveLength(0);
  });

  it('normalizes an object-shaped Lua strategy list into a sorted name array', async () => {
    mockLua({ GrandStrategy: 1, EconomicStrategies: { '0': 11, '1': 10 }, MilitaryStrategies: {} });

    await client.call({ PlayerID: 3, Rationale: 'noop' });

    const previous = (await store.getMutableKnowledgeHistory('StrategyChanges', 3)).find((h) => h.Version === 1)!;
    // Object values [11,10] -> names -> sorted alphabetically.
    expect(previous.EconomicStrategies).toEqual(['Growth', 'Trade']);
  });

  it('writes StrategyChanges visible only to the acting player', async () => {
    mockLua({ GrandStrategy: 1, EconomicStrategies: [], MilitaryStrategies: [] });

    await client.call({ PlayerID: 0, GrandStrategy: 'Culture', Rationale: 'r' });

    expect(await store.getMutableKnowledge('StrategyChanges', 0, 0)).not.toBeUndefined();
    expect(await store.getMutableKnowledge('StrategyChanges', 0, 1)).toBeUndefined();
  });

  it('does no store write or push when the Lua call fails', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success: false } as any);

    const result = await client.call({ PlayerID: 0, GrandStrategy: 'Culture', Rationale: 'r' });
    expect(result.Success).toBe(false);
    expect(await store.getMutableKnowledgeHistory('StrategyChanges', 0)).toHaveLength(0);
    expect(actionPushes()).toHaveLength(0);
  });
});
