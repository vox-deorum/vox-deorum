/**
 * Tests for the player-relationships getter: it reads from a seeded in-memory store.
 * No Lua boundary is exercised on the happy path (PlayerInformations is read from the
 * store cache). We assert the "latest change per target" aggregation, civ-name mapping,
 * unknown-player validation, and empty-data behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore, seedPlayer } from '../../helpers.js';
import { getPlayerRelationships } from '../../../../src/knowledge/getters/player-relationships.js';
import type { KnowledgeStore } from '../../../../src/knowledge/store.js';

let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupStore(10);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

/** Seed one RelationshipChanges row. */
async function seedRelationship(
  playerId: number,
  targetId: number,
  publicValue: number,
  privateValue: number,
  rationale: string,
  turn: number
) {
  await store.storeTimedKnowledge('RelationshipChanges', {
    data: {
      PlayerID: playerId,
      TargetID: targetId,
      PublicValue: publicValue,
      PrivateValue: privateValue,
      Rationale: rationale,
    },
    turn,
  });
}

describe('getPlayerRelationships', () => {
  it('throws when the player does not exist in PlayerInformations', async () => {
    await seedPlayer(store, 0, { civilization: 'Rome' });
    await expect(getPlayerRelationships(5)).rejects.toThrow(/No player found with ID 5/);
  });

  it('returns an empty record when the player has no relationship changes', async () => {
    await seedPlayer(store, 0, { civilization: 'Rome' });
    expect(await getPlayerRelationships(0)).toEqual({});
  });

  it('returns only the latest change per target, mapped to civilization names', async () => {
    await seedPlayer(store, 0, { civilization: 'Rome' });
    await seedPlayer(store, 1, { civilization: 'Greece' });
    await seedPlayer(store, 2, { civilization: 'Egypt' });

    // Two changes toward Greece on different turns; the turn-9 one should win.
    await seedRelationship(0, 1, 10, 5, 'old toward greece', 8);
    await seedRelationship(0, 1, 20, 15, 'new toward greece', 9);
    // One change toward Egypt.
    await seedRelationship(0, 2, -5, -8, 'wary of egypt', 7);

    const result = await getPlayerRelationships(0);
    expect(Object.keys(result).sort()).toEqual(['Egypt', 'Greece']);
    expect(result.Greece).toEqual({
      Public: 20,
      Private: 15,
      Rationale: 'new toward greece',
      UpdatedTurn: 9,
    });
    expect(result.Egypt).toEqual({
      Public: -5,
      Private: -8,
      Rationale: 'wary of egypt',
      UpdatedTurn: 7,
    });
  });

  it('drops changes whose target is not a known player (visibility/mapping)', async () => {
    await seedPlayer(store, 0, { civilization: 'Rome' });
    await seedPlayer(store, 1, { civilization: 'Greece' });

    await seedRelationship(0, 1, 7, 7, 'known target', 5);
    // Target 9 has no PlayerInformations row -> should be omitted from the result.
    await seedRelationship(0, 9, 99, 99, 'unknown target', 6);

    const result = await getPlayerRelationships(0);
    expect(Object.keys(result)).toEqual(['Greece']);
  });

  it('scopes results to the requested player only', async () => {
    await seedPlayer(store, 0, { civilization: 'Rome' });
    await seedPlayer(store, 1, { civilization: 'Greece' });

    await seedRelationship(0, 1, 1, 1, 'rome toward greece', 5);
    await seedRelationship(1, 0, 2, 2, 'greece toward rome', 5);

    const result = await getPlayerRelationships(0);
    expect(Object.keys(result)).toEqual(['Greece']);
    expect(result.Greece.Public).toBe(1);
  });
});
