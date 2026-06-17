/**
 * Tests for the city-information getter: the Lua boundary is stubbed and the
 * mutable batch store-write path runs against a real in-memory KnowledgeStore.
 *
 * Visibility for CityInformations is decided inside the Lua script (the getter
 * passes no visibility flags), so these tests assert the store round-trip,
 * empty-data behavior, and the build-list passthrough rather than re-deriving
 * visibility. The building-chain filter (which needs the game DB) is only
 * triggered for non-empty ImportantBuildings, so we keep those empty here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../../helpers.js';
import { LuaFunction } from '../../../../src/bridge/lua-function.js';
import { getCityInformations } from '../../../../src/knowledge/getters/city-information.js';
import type { KnowledgeStore } from '../../../../src/knowledge/store.js';

let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupStore(10);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

/** Stub the Lua boundary to return a canned cities array. */
function mockLua(result: unknown, success = true) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success, result } as any);
}

/** A complete CityInformations row (all notNull columns) keyed by Key. */
function city(key: number, over: Record<string, unknown> = {}) {
  return {
    Key: key,
    Owner: `Leader${key}`,
    Name: `City${key}`,
    X: 1, Y: 2,
    Population: 5,
    MajorityReligion: null,
    DefenseStrength: 10,
    HitPoints: 100, MaxHitPoints: 100,
    IsCapital: 0, IsPuppet: 0, IsOccupied: 0, IsCoastal: 0,
    FoodStored: 0, FoodPerTurn: 1,
    ProductionStored: 0, ProductionPerTurn: 1,
    GoldPerTurn: 1, SciencePerTurn: 1, CulturePerTurn: 1, FaithPerTurn: 0,
    TourismPerTurn: 0, HappinessDelta: 0,
    RazingTurns: 0, ResistanceTurns: 0,
    BuildingCount: 3,
    Wonders: [],
    ImportantBuildings: [],
    GreatWorkCount: 0,
    CurrentProduction: null,
    ProductionTurnsLeft: 0,
    ...over,
  };
}

describe('getCityInformations', () => {
  it('returns an empty array when the Lua call fails (no store write)', async () => {
    mockLua(undefined, false);

    const result = await getCityInformations();
    expect(result).toEqual([]);
    expect(await store.getAllPublicKnowledge('CityInformations')).toHaveLength(0);
  });

  it('returns an empty array and writes nothing when the game has no cities', async () => {
    mockLua([]);

    const result = await getCityInformations();
    expect(result).toEqual([]);
    expect(await store.getAllPublicKnowledge('CityInformations')).toHaveLength(0);
  });

  it('stores each city as mutable knowledge keyed by City ID and returns them', async () => {
    mockLua([city(10), city(11)]);

    const result = await getCityInformations();
    expect(result).toHaveLength(2);

    const stored10 = await store.getMutableKnowledge('CityInformations', 10);
    expect(stored10).toMatchObject({ Key: 10, Name: 'City10', Version: 1, IsLatest: 1, Turn: 10 });
    const stored11 = await store.getMutableKnowledge('CityInformations', 11);
    expect(stored11).toMatchObject({ Key: 11, Name: 'City11' });
  });

  it('re-storing a changed city bumps its version, keeping history queryable', async () => {
    mockLua([city(10, { Population: 5 })]);
    await getCityInformations();

    mockLua([city(10, { Population: 6 })]);
    await getCityInformations();

    const history = await store.getMutableKnowledgeHistory('CityInformations', 10);
    expect(history.map((h) => h.Version)).toEqual([2, 1]);
    expect(history.find((h) => h.Version === 2)!.Population).toBe(6);
  });
});
