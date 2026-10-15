/**
 * Tests for the set-relationship action tool. The Lua boundary is stubbed (no bridge);
 * player-existence validation reads real seeded PlayerInformations from the in-memory
 * store (so the getter never reaches Lua), and the RelationshipChanges store write,
 * change detection, and replay push run for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore, seedPlayer } from '../helpers.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import createSetRelationshipTool from '../../../src/tools/actions/set-relationship.js';
import createGetOptionsTool from '../../../src/tools/knowledge/get-options.js';
import { getTool } from '../../../src/tools/index.js';
import * as playerOptions from '../../../src/knowledge/getters/player-options.js';
import * as playerPersona from '../../../src/knowledge/getters/player-persona.js';
import * as playerStrategy from '../../../src/knowledge/getters/player-strategy.js';
import { enumMappings } from '../../../src/utils/knowledge/enum.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { connectToolClient } from '../tool-client.js';

const tool = createSetRelationshipTool();
const readTool = createGetOptionsTool();
let store: KnowledgeStore;
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  store = await setupStore(10);
  // Seed both players so readPublicKnowledgeBatch returns from cache (no Lua getter).
  await seedPlayer(store, 0, { civilization: 'Rome' });
  await seedPlayer(store, 1, { civilization: 'Egypt' });
  enumMappings.GrandStrategy = { 0: 'None' };
  vi.spyOn(playerOptions, 'getPlayerOptions').mockResolvedValue([{
    PlayerID: 0,
    EconomicStrategies: [],
    MilitaryStrategies: [],
    Technologies: [],
    NextResearch: null,
    Policies: [],
    PolicyBranches: [],
    NextPolicy: null,
    NextBranch: null,
  }] as any);
  vi.spyOn(playerPersona, 'getPlayerPersona').mockResolvedValue(null);
  vi.spyOn(playerStrategy, 'getPlayerStrategy').mockResolvedValue(null);
  for (const name of ['getTechnology', 'getPolicy', 'getEconomicStrategy', 'getMilitaryStrategy']) {
    vi.spyOn(getTool(name)!, 'getSummaries').mockResolvedValue([] as any);
  }
  client = await connectToolClient(tool, readTool);
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete (enumMappings as any).GrandStrategy;
  await client.close();
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
  it.each([-100, 100])('accepts relationship modifier endpoint %i through MCP', async (value) => {
    mockLua(0, 0);

    const result = await client.call({
      PlayerID: 0,
      TargetID: 1,
      Public: value,
      Private: value,
      Rationale: 'Endpoint modifier',
    });

    expect(result.Success).toBe(true);
    const options = await client.call({ PlayerID: 0 }, readTool.name);
    expect(options.Relationships.Egypt).toMatchObject({ Public: value, Private: value });
  });

  it('throws when the target player is not seeded', async () => {
    mockLua(0, 0);
    await expect(
      client.call({ PlayerID: 0, TargetID: 5, Public: 10, Rationale: 'r' })
    ).rejects.toThrow();
  });

  it('stores a RelationshipChanges row stamped with the turn', async () => {
    mockLua(0, 0);

    await client.call({
      PlayerID: 0,
      TargetID: 1,
      Public: 30,
      Private: -20,
      Rationale: 'Build trust',
    });

    const result = await client.call({ PlayerID: 0 }, readTool.name);
    expect(result.Relationships.Egypt).toEqual({
      Public: 30,
      Private: -20,
      Rationale: 'Build trust',
      UpdatedTurn: 10,
    });
  });

  it('does no store write or push when the Lua call fails', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success: false } as any);

    const result = await client.call({
      PlayerID: 0,
      TargetID: 1,
      Public: 30,
      Rationale: 'r',
    });
    expect(result.Success).toBe(false);
    const options = await client.call({ PlayerID: 0 }, readTool.name);
    expect(options.Relationships ?? {}).toEqual({});
  });
});
