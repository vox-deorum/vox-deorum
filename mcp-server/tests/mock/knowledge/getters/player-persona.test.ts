/**
 * Tests for the player-persona getter: the Lua boundary is stubbed and the
 * mutable store-write path (rationale wrapping, player-scoped visibility) runs
 * against a real in-memory KnowledgeStore.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../../helpers.js';
import { LuaFunction } from '../../../../src/bridge/lua-function.js';
import { getPlayerPersona } from '../../../../src/knowledge/getters/player-persona.js';
import type { KnowledgeStore } from '../../../../src/knowledge/store.js';

let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupStore(10);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

/** Stub the Lua boundary to return a canned persona payload. */
function mockLua(result: unknown, success = true) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success, result } as any);
}

/** A complete persona table (all notNull PersonaChanges columns) with a fixed base value. */
function fullPersona(base = 5): Record<string, number> {
  const fields = [
    'VictoryCompetitiveness', 'WonderCompetitiveness', 'MinorCivCompetitiveness', 'Boldness',
    'WarBias', 'HostileBias', 'WarmongerHate', 'NeutralBias', 'FriendlyBias', 'GuardedBias', 'AfraidBias',
    'DiplomaticBalance', 'Friendliness', 'WorkWithWillingness', 'WorkAgainstWillingness', 'Loyalty',
    'MinorCivFriendlyBias', 'MinorCivNeutralBias', 'MinorCivHostileBias', 'MinorCivWarBias',
    'DenounceWillingness', 'Forgiveness', 'Meanness', 'Neediness', 'Chattiness', 'DeceptiveBias',
  ];
  return Object.fromEntries(fields.map((f) => [f, base]));
}

describe('getPlayerPersona', () => {
  it('returns null when the Lua call fails (no store write)', async () => {
    mockLua(undefined, false);

    expect(await getPlayerPersona(1)).toBeNull();
    expect(await store.getMutableKnowledgeHistory('PersonaChanges', 1)).toHaveLength(0);
  });

  it('persists the persona scoped to the player and wraps the rationale', async () => {
    const persona = fullPersona(7);
    mockLua(persona);

    const result = await getPlayerPersona(1);
    expect(result).toMatchObject({ Boldness: 7, Loyalty: 7 });

    const stored = await store.getMutableKnowledge('PersonaChanges', 1, 1);
    expect(stored).toMatchObject({ Key: 1, Boldness: 7 });
    // First write wraps the (unknown) prior rationale.
    expect((stored as any).Rationale).toMatch(/^Tweaked by In-Game AI/);
    // Visible only to player 1.
    expect(await store.getMutableKnowledge('PersonaChanges', 1, 2)).toBeUndefined();
  });

  it('does not double-wrap an already In-Game AI rationale on a follow-up read', async () => {
    mockLua(fullPersona(7));
    await getPlayerPersona(1);

    // Change a value so a new version is written, then inspect the rationale.
    mockLua(fullPersona(9));
    await getPlayerPersona(1);

    const history = await store.getMutableKnowledgeHistory('PersonaChanges', 1);
    expect(history.map((h) => h.Version)).toEqual([2, 1]);
    const latest = history.find((h) => h.Version === 2)! as any;
    // Already prefixed → not wrapped again into "Tweaked by In-Game AI (Tweaked ...".
    expect(latest.Rationale).toBe('Tweaked by In-Game AI (Unknown)');
  });
});
