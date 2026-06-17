/**
 * Tests for the military-report getter: the Lua boundary is stubbed and the
 * enum post-processing (AI-type / unit-type id -> name conversion across units
 * and zones) plus the TacticalZones timed store-write path run against a real
 * in-memory KnowledgeStore.
 *
 * UnitType is normally loaded from the game DB at runtime; the mock tier has no
 * DB, so we inject it into `enumMappings`. AIType (UnitAITypes) ships statically.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../../helpers.js';
import { LuaFunction } from '../../../../src/bridge/lua-function.js';
import { enumMappings } from '../../../../src/utils/knowledge/enum.js';
import { getMilitaryReport } from '../../../../src/knowledge/getters/military-report.js';
import { UnitAITypes } from '../../../../src/database/enums/UnitAITypes.js';
import type { KnowledgeStore } from '../../../../src/knowledge/store.js';

let store: KnowledgeStore;

// Pick a real AIType id/name pair from the static map for an exact assertion.
const [aiId, aiName] = Object.entries(UnitAITypes)[0] as [string, string];

beforeEach(async () => {
  store = await setupStore(10);
  enumMappings.UnitType = { 1: 'Warrior', 2: 'Archer' };
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete (enumMappings as any).UnitType;
  await store.close();
});

/** Stub the Lua boundary to return a canned [units, zones] tuple. */
function mockLua(result: unknown, success = true) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success, result } as any);
}

/** A complete TacticalZones row (all notNull columns) keyed by ZoneID. */
function zone(over: Record<string, unknown> = {}) {
  return {
    ZoneID: 1,
    Territory: 'Friendly',
    Dominance: 'Friendly',
    Domain: 'Land',
    Posture: 'None',
    AreaID: 1,
    City: null,
    CenterX: 1,
    CenterY: 1,
    Plots: 5,
    Value: 10,
    FriendlyStrength: 100,
    EnemyStrength: 0,
    NeutralStrength: 0,
    Neighbors: [2, 3],
    ...over,
  };
}

describe('getMilitaryReport', () => {
  it('returns null when the Lua call fails', async () => {
    mockLua(undefined, false);
    expect(await getMilitaryReport(1)).toBeNull();
  });

  it('returns null when the result is missing the [units, zones] tuple', async () => {
    mockLua([{}]); // length < 2
    expect(await getMilitaryReport(1)).toBeNull();
  });

  it('converts AI-type and unit-type ids to names in units and zones, and stores zones', async () => {
    mockLua([
      // units: aiType -> unitType -> data
      { [aiId]: { 1: { count: 3 }, 2: { count: 1 } } },
      // zones: keyed object; Units is Civ -> unitTypeId -> count
      { z1: zone({ Units: { Rome: { 1: 4, 2: 2 } } }) },
    ]);

    const result = await getMilitaryReport(1);
    expect(result).not.toBeNull();

    // Unit AI-type and unit-type ids resolved to names.
    expect(result!.units[aiName]).toBeDefined();
    expect(result!.units[aiName].Warrior).toEqual({ count: 3 });
    expect(result!.units[aiName].Archer).toEqual({ count: 1 });

    // Zone unit-type ids resolved to names.
    expect(result!.zones.z1.Units.Rome).toEqual({ Warrior: 4, Archer: 2 });

    // Persisted to TacticalZones with player visibility and the manager turn.
    const rows = await store.getDatabase().selectFrom('TacticalZones').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ZoneID: 1, PlayerID: 1, Turn: 10 });
    // Visible to player 1, not to player 2.
    expect((rows[0] as any).Player1).toBe(2);
    expect((rows[0] as any).Player2).toBe(0);
  });

  it('falls back to Unknown_<id> for ids absent from the enum maps', async () => {
    mockLua([{ 9999: { 7: { count: 1 } } }, {}]);

    const result = await getMilitaryReport(1, false);
    expect(result!.units.Unknown_9999).toBeDefined();
    expect(result!.units.Unknown_9999.Unknown_7).toEqual({ count: 1 });
  });

  it('does not write to the store when saving=false', async () => {
    mockLua([{}, { z1: zone({ Units: {} }) }]);

    await getMilitaryReport(1, false);
    const rows = await store.getDatabase().selectFrom('TacticalZones').selectAll().execute();
    expect(rows).toHaveLength(0);
  });
});
