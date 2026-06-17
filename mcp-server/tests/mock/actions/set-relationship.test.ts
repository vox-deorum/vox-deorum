/**
 * Tests for the set-relationship action tool. The Lua boundary is stubbed (no bridge);
 * player-existence validation reads real seeded PlayerInformations from the in-memory
 * store (so the getter never reaches Lua), and the RelationshipChanges store write,
 * change detection, and replay push run for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore, seedPlayer } from '../helpers.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import * as playerActions from '../../../src/utils/lua/player-actions.js';
import createSetRelationshipTool from '../../../src/tools/actions/set-relationship.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createSetRelationshipTool();
let store: KnowledgeStore;
let pushSpy: ReturnType<typeof vi.spyOn>;

/** Read all RelationshipChanges rows (TimedKnowledge) for the acting player. */
async function readRelationshipChanges(playerId: number): Promise<any[]> {
  const db = store.getDatabase();
  return (db.selectFrom('RelationshipChanges') as any)
    .selectAll()
    .where('PlayerID', '=', playerId)
    .execute();
}

beforeEach(async () => {
  store = await setupStore(10);
  // Seed both players so readPublicKnowledgeBatch returns from cache (no Lua getter).
  await seedPlayer(store, 0, { civilization: 'Rome' });
  await seedPlayer(store, 1, { civilization: 'Egypt' });
  pushSpy = vi.spyOn(playerActions, 'pushPlayerAction').mockResolvedValue();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

/** Stub the Lua boundary so super.call() returns canned previous public/private values. */
function mockLua(previousPublic: number, previousPrivate: number, targetName = 'Egypt') {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
    success: true,
    result: {
      PreviousPublic: previousPublic,
      PreviousPrivate: previousPrivate,
      TargetPlayerName: targetName,
    },
  } as any);
}

describe('set-relationship', () => {
  it('throws when the target player is not seeded', async () => {
    mockLua(0, 0);
    await expect(
      tool.execute({ PlayerID: 0, TargetID: 5, Public: 10, Rationale: 'r' } as any)
    ).rejects.toThrow(/Target player with ID 5 not found/);
  });

  it('stores a RelationshipChanges row stamped with the turn', async () => {
    mockLua(0, 0);

    await tool.execute({
      PlayerID: 0,
      TargetID: 1,
      Public: 30,
      Private: -20,
      Rationale: 'Build trust',
    } as any);

    const rows = await readRelationshipChanges(0);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.PlayerID).toBe(0);
    expect(row.TargetID).toBe(1);
    expect(row.PublicValue).toBe(30);
    expect(row.PrivateValue).toBe(-20);
    expect(row.Rationale).toBe('Build trust');
    expect(row.Turn).toBe(10);
  });

  it('pushes a replay action describing the changed public/private deltas', async () => {
    mockLua(5, 5, 'Egypt');

    await tool.execute({
      PlayerID: 0,
      TargetID: 1,
      Public: 30,
      Private: 5, // unchanged vs previous private
      Rationale: 'shift',
    } as any);

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const [playerID, actionType, summary, rationale, prefix] = pushSpy.mock.calls[0];
    expect(playerID).toBe(0);
    expect(actionType).toBe('relationship');
    expect(prefix).toBe('');
    expect(rationale).toBe('shift');
    expect(summary).toContain('Egypt');
    expect(summary).toContain('Public 5 → 30');
    expect(summary).not.toContain('Private'); // unchanged
  });

  it('does not push a replay action when both values are unchanged', async () => {
    mockLua(10, 20);

    await tool.execute({
      PlayerID: 0,
      TargetID: 1,
      Public: 10,
      Private: 20,
      Rationale: 'noop',
    } as any);

    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('does no store write or push when the Lua call fails', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success: false } as any);

    const result = await tool.execute({
      PlayerID: 0,
      TargetID: 1,
      Public: 30,
      Rationale: 'r',
    } as any);
    expect(result.Success).toBe(false);
    expect(await readRelationshipChanges(0)).toHaveLength(0);
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
