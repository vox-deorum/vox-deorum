/**
 * Tests for the player-options getter: the Lua boundary is stubbed and the enum-name
 * conversion + PlayerOptions store-write path runs for real against an in-memory store.
 *
 * The option enum maps (strategies, techs, policies, branches) are normally loaded from
 * the game DB; the mock tier has no DB, so we inject them into `enumMappings` directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../../helpers.js';
import { LuaFunction } from '../../../../src/bridge/lua-function.js';
import { enumMappings } from '../../../../src/utils/knowledge/enum.js';
import { getPlayerOptions } from '../../../../src/knowledge/getters/player-options.js';
import type { KnowledgeStore } from '../../../../src/knowledge/store.js';

let store: KnowledgeStore;

const injectedEnums = ['EconomicStrategy', 'MilitaryStrategy', 'TechID', 'PolicyID', 'BranchType'];

beforeEach(async () => {
  store = await setupStore(10);
  enumMappings.EconomicStrategy = { 10: 'Growth', 11: 'Trade' };
  enumMappings.MilitaryStrategy = { 20: 'War', 21: 'Defense' };
  enumMappings.TechID = { 100: 'Pottery', 101: 'Writing' };
  enumMappings.PolicyID = { 200: 'Tradition', 201: 'Liberty' };
  enumMappings.BranchType = { 300: 'Honor', 301: 'Piety' };
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const key of injectedEnums) delete (enumMappings as any)[key];
  await store.close();
});

/** Stub the Lua boundary to return canned player options. */
function mockLua(result: unknown, success = true) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success, result } as any);
}

const samplePlayer = (playerId: number) => ({
  PlayerID: playerId,
  EconomicStrategies: [11, 10],
  MilitaryStrategies: [20],
  Technologies: [100],
  NextResearch: 101,
  Policies: [200],
  PolicyBranches: [300],
  NextPolicy: 201,
  NextBranch: 301,
});

describe('getPlayerOptions', () => {
  it('returns an empty array when the Lua call fails', async () => {
    mockLua(undefined, false);
    expect(await getPlayerOptions()).toEqual([]);
  });

  it('converts numeric IDs to names and persists per-player with player visibility', async () => {
    mockLua([samplePlayer(0)]);

    const result = await getPlayerOptions();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      PlayerID: 0,
      EconomicStrategies: ['Trade', 'Growth'], // map order preserved (no sort here)
      MilitaryStrategies: ['War'],
      Technologies: ['Pottery'],
      NextResearch: 'Writing',
      Policies: ['Tradition'],
      PolicyBranches: ['Honor'],
      NextPolicy: 'Liberty',
      NextBranch: 'Piety',
    });

    // Persisted as timed knowledge, visible to player 0 only.
    const visibleTo0 = await store
      .getDatabase()
      .selectFrom('PlayerOptions')
      .selectAll()
      .where('Player0', '>', 0)
      .execute();
    expect(visibleTo0).toHaveLength(1);
    expect(visibleTo0[0]).toMatchObject({ PlayerID: 0, Turn: 10 });

    const visibleTo1 = await store
      .getDatabase()
      .selectFrom('PlayerOptions')
      .selectAll()
      .where('Player1', '>', 0)
      .execute();
    expect(visibleTo1).toHaveLength(0);
  });

  it('handles missing/empty option fields without throwing', async () => {
    mockLua([
      {
        PlayerID: 2,
        // No strategy/tech/policy arrays at all, null next-* values.
        NextResearch: null,
        NextPolicy: undefined,
      },
    ]);

    const result = await getPlayerOptions();
    expect(result[0]).toMatchObject({
      PlayerID: 2,
      EconomicStrategies: [],
      MilitaryStrategies: [],
      Technologies: [],
      Policies: [],
      PolicyBranches: [],
      NextResearch: null,
      NextPolicy: null,
    });
  });

  it('does not write to the store when saving=false', async () => {
    mockLua([samplePlayer(0)]);
    const result = await getPlayerOptions(false);
    expect(result[0]).toMatchObject({ PlayerID: 0 });

    const rows = await store.getDatabase().selectFrom('PlayerOptions').selectAll().execute();
    expect(rows).toHaveLength(0);
  });
});
