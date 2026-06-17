/**
 * Tests for the unset-flavors action tool. The Lua boundary is stubbed (no bridge); the
 * store delta (marking any existing FlavorChanges row as IsLatest=0) and the replay push
 * run for real against an in-memory KnowledgeStore. No game-enum dependency.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import { composeVisibility } from '../../../src/utils/knowledge/visibility.js';
import * as playerActions from '../../../src/utils/lua/player-actions.js';
import createUnsetFlavorsTool from '../../../src/tools/actions/unset-flavors.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createUnsetFlavorsTool();
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

/** Stub the Lua boundary so super.call() returns the canned unset-success payload. */
function mockLua(success = true, message = 'Custom flavors cleared successfully') {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
    success: true,
    result: { Success: success, Message: message },
  } as any);
}

/** Seed a current FlavorChanges row for a player so the unset can mark it historical. */
async function seedFlavorRow(playerId: number) {
  await store.storeMutableKnowledge(
    'FlavorChanges',
    playerId,
    { Offense: 70, GrandStrategy: 'Conquest', Rationale: 'seed' } as any,
    composeVisibility([playerId]),
    undefined,
    10
  );
}

describe('unset-flavors', () => {
  describe('schema validation', () => {
    it('rejects a PlayerID above the major-civ max', () => {
      const parsed = tool.inputSchema.safeParse({ PlayerID: 999 });
      expect(parsed.success).toBe(false);
    });

    it('accepts a valid PlayerID and defaults Turn to -1', () => {
      const parsed = tool.inputSchema.safeParse({ PlayerID: 0 });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.Turn).toBe(-1);
    });
  });

  it('marks the existing latest FlavorChanges row as not-latest', async () => {
    await seedFlavorRow(0);
    expect(await store.getMutableKnowledge('FlavorChanges', 0)).not.toBeUndefined();

    mockLua();
    await tool.execute({ PlayerID: 0 } as any);

    // No latest row remains, but the history still holds the now-historical version.
    expect(await store.getMutableKnowledge('FlavorChanges', 0)).toBeUndefined();
    expect(await store.getMutableKnowledgeHistory('FlavorChanges', 0)).toHaveLength(1);
  });

  it('only affects the targeted player rows', async () => {
    await seedFlavorRow(0);
    await seedFlavorRow(1);

    mockLua();
    await tool.execute({ PlayerID: 0 } as any);

    expect(await store.getMutableKnowledge('FlavorChanges', 0)).toBeUndefined();
    expect(await store.getMutableKnowledge('FlavorChanges', 1)).not.toBeUndefined();
  });

  it('pushes an unset-flavors replay action with empty rationale/prefix', async () => {
    mockLua();
    await tool.execute({ PlayerID: 0, Turn: 7 } as any);

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const [playerID, actionType, summary, rationale, prefix, turn] = pushSpy.mock.calls[0];
    expect(playerID).toBe(0);
    expect(actionType).toBe('unset-flavors');
    expect(summary).toContain('Cleared custom flavors');
    expect(rationale).toBe('');
    expect(prefix).toBe('');
    expect(turn).toBe(7);
  });

  it('does not touch the store or push when the Lua call fails', async () => {
    await seedFlavorRow(0);
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success: false } as any);

    const result = await tool.execute({ PlayerID: 0 } as any);
    expect(result.Success).toBe(false);
    // The seeded latest row is untouched.
    expect(await store.getMutableKnowledge('FlavorChanges', 0)).not.toBeUndefined();
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
