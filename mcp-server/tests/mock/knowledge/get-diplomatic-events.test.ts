/**
 * Tests for the get-diplomatic-events tool, exercised against a REAL in-memory
 * KnowledgeStore. GameEvents rows are written directly via store.getDatabase()
 * (with explicit visibility flags); the player-name resolution path reads seeded
 * PlayerInformations from the store, and the city lookup (which would otherwise hit
 * the game DB) is stubbed to [].
 *
 * Focus: player-pair (OtherPlayerID) relevance filtering, result ordering by ID,
 * and per-player visibility. These are distinct from the diplomacy transcript tests
 * (read-transcript / append-message), which cover the DiplomaticMessages thread store.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore, seedPlayer } from '../helpers.js';
import { applyVisibility, composeVisibility } from '../../../src/utils/knowledge/visibility.js';
import * as cityInfo from '../../../src/knowledge/getters/city-information.js';
import createGetDiplomaticEventsTool from '../../../src/tools/knowledge/get-diplomatic-events.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createGetDiplomaticEventsTool();
let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupStore(10);
  // Seed major civs so the tool's name-resolution batch reads from the store
  // (and never falls back to the live getPlayerInformations Lua fetch).
  await seedPlayer(store, 0, { civilization: 'Rome', teamID: 0 });
  await seedPlayer(store, 1, { civilization: 'Egypt', teamID: 1 });
  await seedPlayer(store, 2, { civilization: 'Greece', teamID: 2 });
  // The city coordinate lookup would otherwise hit the game DB; none of our events
  // reference cities, so an empty list is sufficient.
  vi.spyOn(cityInfo, 'getCityInformations').mockResolvedValue([] as any);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

let nextId = 1;

/**
 * Insert one GameEvents row directly into the in-memory DB with explicit
 * per-player visibility. Payload is an object (the store's JsonSerializePlugin
 * serializes it on write; ParseJSONResultsPlugin restores it on read).
 */
async function seedEvent(
  type: string,
  turn: number,
  payload: Record<string, unknown>,
  visibleTo: number[]
): Promise<number> {
  const id = nextId++;
  const row = applyVisibility(
    { ID: id, Turn: turn, Type: type, Payload: payload } as any,
    composeVisibility(visibleTo)
  );
  await store.getDatabase().insertInto('GameEvents').values(row).execute();
  return id;
}

beforeEach(() => {
  nextId = 1;
});

describe('get-diplomatic-events: player-pair relevance filtering', () => {
  beforeEach(async () => {
    // 0 declares war on team 1 (relevant to player 1)
    await seedEvent('DeclareWar', 5,
      { OriginatingPlayerID: 0, TargetTeamID: 1, IsAggressor: true }, [0, 1, 2]);
    // 0 gifts gold to 2 (relevant to player 2, NOT player 1)
    await seedEvent('PlayerGifted', 6,
      { GivingPlayerID: 0, ReceivingPlayerID: 2, GoldAmount: 100 }, [0, 1, 2]);
  });

  it('with no OtherPlayerID, returns every visible diplomatic event', async () => {
    const result = await tool.execute({ PlayerID: 0 } as any);
    const types = Object.values(result).flat().map((e: any) => e.Type);
    expect(types).toContain('DeclareWar');
    expect(types).toContain('PlayerGifted');
  });

  it('OtherPlayerID matches on a playerIdField (PlayerGifted -> player 2)', async () => {
    const result = await tool.execute({ PlayerID: 0, OtherPlayerID: 2 } as any);
    const types = Object.values(result).flat().map((e: any) => e.Type);
    // The gift to player 2 is kept; the war (no player-2 field) is filtered out.
    expect(types).toEqual(['PlayerGifted']);
  });

  it('OtherPlayerID matches on a teamIdField (DeclareWar -> team 1)', async () => {
    const result = await tool.execute({ PlayerID: 0, OtherPlayerID: 1 } as any);
    const types = Object.values(result).flat().map((e: any) => e.Type);
    // The war targets team 1; the gift to player 2 is not relevant to player 1.
    expect(types).toEqual(['DeclareWar']);
  });

  it('OtherPlayerID with no matching events yields an empty result', async () => {
    // Player 1 has no playerIdField match and no team match in the gift event,
    // and player 0 itself is the originator (not the "other" side we ask about).
    const result = await tool.execute({ PlayerID: 0, OtherPlayerID: 99 } as any);
    expect(result).toEqual({});
  });
});

describe('get-diplomatic-events: ordering', () => {
  it('groups by turn and preserves insertion (ID) order within a turn', async () => {
    // Insert out of turn order; the query orders by ID, then buckets by turn.
    await seedEvent('PlayerGifted', 7,
      { GivingPlayerID: 0, ReceivingPlayerID: 1, GoldAmount: 10 }, [0]); // ID 1
    await seedEvent('PlayerGifted', 5,
      { GivingPlayerID: 0, ReceivingPlayerID: 2, GoldAmount: 20 }, [0]); // ID 2
    await seedEvent('PlayerGifted', 5,
      { GivingPlayerID: 0, ReceivingPlayerID: 1, GoldAmount: 30 }, [0]); // ID 3

    const result = await tool.execute({ PlayerID: 0 } as any);

    // Turn buckets present
    expect(Object.keys(result).sort()).toEqual(['5', '7']);
    // Within turn 5, ID 2 precedes ID 3 (insertion order, by ID).
    const turn5 = result['5'].map((e: any) => e.ReceivingPlayer ?? e.ReceivingPlayerID);
    expect(turn5).toEqual([2, 1]);
    // Turn 7 has the single later event.
    expect(result['7']).toHaveLength(1);
  });
});

describe('get-diplomatic-events: visibility', () => {
  beforeEach(async () => {
    // Visible only to player 0
    await seedEvent('PlayerGifted', 5,
      { GivingPlayerID: 0, ReceivingPlayerID: 1, GoldAmount: 10 }, [0]);
    // Visible only to player 1
    await seedEvent('MakePeace', 5,
      { OriginatingPlayerID: 1, TargetTeamID: 0 }, [1]);
  });

  it('returns only events flagged visible to the requesting player', async () => {
    const forZero = await tool.execute({ PlayerID: 0 } as any);
    const forOne = await tool.execute({ PlayerID: 1 } as any);

    const typesZero = Object.values(forZero).flat().map((e: any) => e.Type);
    const typesOne = Object.values(forOne).flat().map((e: any) => e.Type);

    expect(typesZero).toEqual(['PlayerGifted']);
    expect(typesOne).toEqual(['MakePeace']);
  });

  it('returns nothing for a player with no visible events', async () => {
    const forTwo = await tool.execute({ PlayerID: 2 } as any);
    expect(forTwo).toEqual({});
  });
});

describe('get-diplomatic-events: DealMade formatting', () => {
  /** Pull the single formatted markdown line out of a one-event result. */
  const onlyLine = (result: Record<string, any[]>) => Object.values(result).flat()[0] as string;

  it('formats both sides when each is a normal string array', async () => {
    await seedEvent('DealMade', 5,
      { FromPlayerID: 0, ToPlayerID: 1, FromGives: ['Gold: 100'], ToGives: ['Open Borders'] }, [0, 1]);
    const result = await tool.execute({ PlayerID: 0, Formatted: true } as any);
    expect(onlyLine(result)).toBe('Deal: **Rome** gives [Gold: 100] ↔ **Egypt** gives [Open Borders]');
  });

  // Regression: a side that gives nothing arrives from Lua as an empty table, which serializes to
  // JSON as `{}` (an object), not `[]`. formatDealSide must render it as "nothing", not throw
  // `items.join is not a function`.
  it('renders a side that arrives as an empty object ({}) as "nothing" without throwing', async () => {
    await seedEvent('DealMade', 5,
      { FromPlayerID: 0, ToPlayerID: 1, FromGives: ['Gold: 100'], ToGives: {} }, [0, 1]);
    const result = await tool.execute({ PlayerID: 0, Formatted: true } as any);
    expect(onlyLine(result)).toBe('Deal: **Rome** gives [Gold: 100] ↔ **Egypt** gives [nothing]');
  });

  it('renders missing give fields as "nothing"', async () => {
    await seedEvent('DealMade', 5,
      { FromPlayerID: 0, ToPlayerID: 1 }, [0, 1]);
    const result = await tool.execute({ PlayerID: 0, Formatted: true } as any);
    expect(onlyLine(result)).toBe('Deal: **Rome** gives [nothing] ↔ **Egypt** gives [nothing]');
  });
});
