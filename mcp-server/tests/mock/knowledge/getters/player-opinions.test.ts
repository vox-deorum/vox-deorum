/**
 * Tests for the player-opinions getter: the Lua boundary is stubbed and the
 * aggregation + store-write path runs against a real in-memory KnowledgeStore.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../../helpers.js';
import { LuaFunction } from '../../../../src/bridge/lua-function.js';
import { getPlayerOpinions } from '../../../../src/knowledge/getters/player-opinions.js';
import type { KnowledgeStore } from '../../../../src/knowledge/store.js';

let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupStore(10);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

/** Stub the Lua boundary to return a canned opinions payload. */
function mockLua(result: unknown, success = true) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success, result } as any);
}

describe('getPlayerOpinions', () => {
  it('returns undefined for an undefined player without touching Lua', async () => {
    const spy = vi.spyOn(LuaFunction.prototype, 'execute');
    expect(await getPlayerOpinions(undefined)).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns undefined when the Lua call fails', async () => {
    mockLua(undefined, false);
    expect(await getPlayerOpinions(1)).toBeUndefined();
  });

  it('maps opinion lists into From/To fields and persists with player visibility', async () => {
    mockLua({ 2: [['Likes your culture'], ['You distrust them']] });

    const result = await getPlayerOpinions(1);
    expect(result).toMatchObject({
      Key: 1,
      OpinionFrom2: 'Likes your culture',
      OpinionTo2: 'You distrust them',
    });

    // Persisted as mutable knowledge, visible to player 1 only.
    const stored = await store.getMutableKnowledge('PlayerOpinions', 1, 1);
    expect(stored).toMatchObject({ Key: 1, OpinionFrom2: 'Likes your culture' });
    expect(await store.getMutableKnowledge('PlayerOpinions', 1, 3)).toBeUndefined();
  });

  it('does not write to the store when saving=false', async () => {
    mockLua({ 2: [['x'], ['y']] });
    const result = await getPlayerOpinions(1, false);
    expect(result).toMatchObject({ OpinionFrom2: 'x' });
    expect(await store.getMutableKnowledge('PlayerOpinions', 1)).toBeUndefined();
  });
});
