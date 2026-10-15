/**
 * Tests for the keep-status-quo action tool. The Lua boundary (the refresh script
 * run via super.call) is stubbed; the post-processing — reading the previous
 * StrategyChanges, writing a new version with the trimmed rationale, the
 * "[skipped]" sentinel short-circuit, and the status-quo action push — runs for
 * real against an in-memory KnowledgeStore.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore, actionPushes } from '../helpers.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import createKeepStatusQuoTool from '../../../src/tools/actions/keep-status-quo.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { connectToolClient } from '../tool-client.js';

const tool = createKeepStatusQuoTool();
let store: KnowledgeStore;
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  store = await setupStore(10);
  client = await connectToolClient(tool);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await client.close();
  await store.close();
});

/** Stub the refresh Lua call to succeed (or fail). */
function mockLua(success = true) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success, result: true } as any);
}

/** Seed a baseline StrategyChanges row so the status-quo carry-forward has data. */
async function seedStrategy(playerID: number) {
  await store.storeMutableKnowledge('StrategyChanges', playerID, {
    GrandStrategy: 'Conquest',
    EconomicStrategies: ['Growth'],
    MilitaryStrategies: ['War'],
    Rationale: 'baseline',
  } as any);
}

describe('keep-status-quo', () => {
  it('carries the previous strategies forward into a new version and pushes a status-quo action with no replay message', async () => {
    mockLua();
    await seedStrategy(0);

    const result = await client.call({ PlayerID: 0, Mode: 'Strategy', Rationale: 'Stay the course' });
    expect(result.Success).toBe(true);

    const history = await store.getMutableKnowledgeHistory('StrategyChanges', 0);
    expect(history.map((h) => h.Version)).toEqual([2, 1]);

    const latest = history.find((h) => h.Version === 2)!;
    expect(latest.GrandStrategy).toBe('Conquest');
    expect(latest.EconomicStrategies).toEqual(['Growth']);
    expect(latest.MilitaryStrategies).toEqual(['War']);
    expect(latest.Rationale).toBe('Stay the course');
    expect(latest.Turn).toBe(10);

    const pushes = actionPushes();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ playerID: 0, actionType: 'status-quo', rationale: 'Stay the course', turn: 10 });
    expect(pushes[0].replayPrefix).toBeUndefined(); // status-quo fires the event only, no replay message
    expect(pushes[0].summary).toContain('Strategy');
  });

  it('writes defaults when no previous strategy exists', async () => {
    mockLua();

    await client.call({ PlayerID: 2, Mode: 'Strategy', Rationale: 'fresh' });

    const latest = (await store.getMutableKnowledge('StrategyChanges', 2))!;
    expect(latest.EconomicStrategies).toEqual([]);
    expect(latest.MilitaryStrategies).toEqual([]);
    expect(latest.Rationale).toBe('fresh');
  });

  it('refreshes in-game settings but records nothing for the "[skipped]" sentinel', async () => {
    mockLua();
    await seedStrategy(0);

    const result = await client.call({ PlayerID: 0, Mode: 'Strategy', Rationale: '[skipped]' });
    expect(result.Success).toBe(true);

    // No new StrategyChanges version, no action push.
    const history = await store.getMutableKnowledgeHistory('StrategyChanges', 0);
    expect(history.map((h) => h.Version)).toEqual([1]);
    expect(actionPushes()).toHaveLength(0);
  });

  it('does no store write or push when the Lua refresh fails', async () => {
    mockLua(false);
    await seedStrategy(0);

    const result = await client.call({ PlayerID: 0, Mode: 'Strategy', Rationale: 'keep' });
    expect(result.Success).toBe(false);

    const history = await store.getMutableKnowledgeHistory('StrategyChanges', 0);
    expect(history.map((h) => h.Version)).toEqual([1]); // only the seed remains
    expect(actionPushes()).toHaveLength(0);
  });
});
