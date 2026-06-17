/**
 * Tests for the keep-status-quo action tool. The Lua boundary (the refresh script
 * run via super.call) is stubbed; the post-processing — reading the previous
 * StrategyChanges, writing a new version with the trimmed rationale, the
 * "[skipped]" sentinel short-circuit, and the status-quo action push — runs for
 * real against an in-memory KnowledgeStore.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import * as playerActions from '../../../src/utils/lua/player-actions.js';
import createKeepStatusQuoTool, { SKIPPED_RATIONALE } from '../../../src/tools/actions/keep-status-quo.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createKeepStatusQuoTool();
let store: KnowledgeStore;
let pushSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  store = await setupStore(10);
  pushSpy = vi.spyOn(playerActions, 'pushPlayerAction').mockResolvedValue();
});

afterEach(async () => {
  vi.restoreAllMocks();
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
  it('carries the previous strategies forward into a new version with the new rationale', async () => {
    mockLua();
    await seedStrategy(0);

    const result = await tool.execute({ PlayerID: 0, Mode: 'Strategy', Rationale: 'Stay the course' } as any);
    expect(result.Success).toBe(true);

    const history = await store.getMutableKnowledgeHistory('StrategyChanges', 0);
    expect(history.map((h) => h.Version)).toEqual([2, 1]);

    const latest = history.find((h) => h.Version === 2)!;
    expect(latest.GrandStrategy).toBe('Conquest');
    expect(latest.EconomicStrategies).toEqual(['Growth']);
    expect(latest.MilitaryStrategies).toEqual(['War']);
    expect(latest.Rationale).toBe('Stay the course');
    expect(latest.Turn).toBe(10);
  });

  it('pushes a status-quo action event with no replay prefix', async () => {
    mockLua();
    await seedStrategy(0);

    await tool.execute({ PlayerID: 0, Mode: 'Strategy', Rationale: 'keep' } as any);

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const [playerID, actionType, summary, rationale, prefix] = pushSpy.mock.calls[0];
    expect(playerID).toBe(0);
    expect(actionType).toBe('status-quo');
    expect(summary).toBe('Maintaining Strategy');
    expect(rationale).toBe('keep');
    expect(prefix).toBeUndefined();
  });

  it('writes defaults when no previous strategy exists', async () => {
    mockLua();

    await tool.execute({ PlayerID: 2, Mode: 'Strategy', Rationale: 'fresh' } as any);

    const latest = (await store.getMutableKnowledge('StrategyChanges', 2))!;
    expect(latest.EconomicStrategies).toEqual([]);
    expect(latest.MilitaryStrategies).toEqual([]);
    expect(latest.Rationale).toBe('fresh');
  });

  it('refreshes in-game settings but records nothing for the "[skipped]" sentinel', async () => {
    mockLua();
    await seedStrategy(0);

    const result = await tool.execute({ PlayerID: 0, Mode: 'Strategy', Rationale: SKIPPED_RATIONALE } as any);
    expect(result.Success).toBe(true);

    // No new StrategyChanges version, no action push.
    const history = await store.getMutableKnowledgeHistory('StrategyChanges', 0);
    expect(history.map((h) => h.Version)).toEqual([1]);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('does no store write or push when the Lua refresh fails', async () => {
    mockLua(false);
    await seedStrategy(0);

    const result = await tool.execute({ PlayerID: 0, Mode: 'Strategy', Rationale: 'keep' } as any);
    expect(result.Success).toBe(false);

    const history = await store.getMutableKnowledgeHistory('StrategyChanges', 0);
    expect(history.map((h) => h.Version)).toEqual([1]); // only the seed remains
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
