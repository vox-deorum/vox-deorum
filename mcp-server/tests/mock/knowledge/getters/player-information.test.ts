/**
 * Tests for the player-information getter: the Lua boundary is stubbed and the
 * filter + public-knowledge store-write path runs against a real in-memory
 * KnowledgeStore.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../../helpers.js';
import { LuaFunction } from '../../../../src/bridge/lua-function.js';
import { getPlayerInformations } from '../../../../src/knowledge/getters/player-information.js';
import type { KnowledgeStore } from '../../../../src/knowledge/store.js';

let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupStore(10);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

/** Stub the Lua boundary to return a canned players payload. */
function mockLua(result: unknown, success = true) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success, result } as any);
}

const player = (key: number, over: Record<string, unknown> = {}) => ({
  Key: key,
  TeamID: key,
  Civilization: `Civ${key}`,
  Leader: `Leader${key}`,
  IsHuman: 0,
  IsMajor: 1,
  ...over,
});

describe('getPlayerInformations', () => {
  it('returns an empty array when the Lua call fails (no store write)', async () => {
    mockLua(undefined, false);

    const result = await getPlayerInformations();
    expect(result).toEqual([]);
    expect(await store.getAllPublicKnowledge('PlayerInformations')).toHaveLength(0);
  });

  it('stores each returned player as public knowledge and returns them', async () => {
    mockLua([player(0), player(1, { IsHuman: 1 })]);

    const result = await getPlayerInformations();
    expect(result).toHaveLength(2);

    const stored = await store.getAllPublicKnowledge('PlayerInformations');
    expect(stored).toHaveLength(2);
    expect(await store.getPublicKnowledge('PlayerInformations', 0)).toMatchObject({
      Key: 0,
      Civilization: 'Civ0',
      Leader: 'Leader0',
    });
    expect(await store.getPublicKnowledge('PlayerInformations', 1)).toMatchObject({
      Key: 1,
      IsHuman: 1,
    });
  });

  it('does not write to the store when saving=false but still returns the players', async () => {
    mockLua([player(0), player(1)]);

    const result = await getPlayerInformations(false);
    expect(result).toHaveLength(2);
    // Public knowledge is global (no visibility columns), so emptiness proves no write.
    expect(await store.getAllPublicKnowledge('PlayerInformations')).toHaveLength(0);
  });
});
