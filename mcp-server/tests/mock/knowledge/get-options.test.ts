/**
 * Tests for the get-options tool, exercised against a REAL in-memory KnowledgeStore
 * (the get-diplomatic-events pattern). The player-options Lua fetch is stubbed, the
 * game-DB summary tools and the persona/strategy fallback fetches are stubbed to empty
 * results, and the GrandStrategy enum is injected since the mock tier has no game DB.
 *
 * Focus: the Policy.Next framing from the stored PolicyChanges selection, including the
 * cleared ("None") case, which must render as plain None without a (Policy)/(New Branch)
 * suffix, and pending selections, which keep their framing and rationale.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore, seedPlayer } from '../helpers.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import { enumMappings } from '../../../src/utils/knowledge/enum.js';
import * as playerPersona from '../../../src/knowledge/getters/player-persona.js';
import * as playerStrategy from '../../../src/knowledge/getters/player-strategy.js';
import { getTool } from '../../../src/tools/index.js';
import createGetOptionsTool from '../../../src/tools/knowledge/get-options.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { connectToolClient } from '../tool-client.js';

const tool = createGetOptionsTool();
let store: KnowledgeStore;
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  store = await setupStore(10);
  // getPlayerRelationships validates the player against stored PlayerInformations.
  await seedPlayer(store, 0, { civilization: 'Rome', teamID: 0 });
  // The GrandStrategy options list reads this enum; the mock tier never loads it from a game DB.
  enumMappings.GrandStrategy = { 0: 'None', 1: 'Capitalist' };

  // The player-options Lua fetch: one player, no available lists, no pending selections.
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
    success: true,
    result: [{
      PlayerID: 0,
      EconomicStrategies: {},
      MilitaryStrategies: {},
      Technologies: {},
      NextResearch: null,
      Policies: {},
      PolicyBranches: {},
      NextPolicy: null,
      NextBranch: null,
    }],
  } as any);
  // Persona/strategy cache reads would otherwise fall back to their own Lua getters.
  vi.spyOn(playerPersona, 'getPlayerPersona').mockResolvedValue(null);
  vi.spyOn(playerStrategy, 'getPlayerStrategy').mockResolvedValue(null);
  // The database summary tools would hit the game DB, which the mock tier lacks.
  vi.spyOn(getTool('getTechnology')!, 'getSummaries').mockResolvedValue([] as any);
  vi.spyOn(getTool('getPolicy')!, 'getSummaries').mockResolvedValue([] as any);
  vi.spyOn(getTool('getEconomicStrategy')!, 'getSummaries').mockResolvedValue([] as any);
  vi.spyOn(getTool('getMilitaryStrategy')!, 'getSummaries').mockResolvedValue([] as any);

  client = await connectToolClient(tool);
});

afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
  delete (enumMappings as any).GrandStrategy;
  await store.close();
});

/** Seed this player's PolicyChanges row (what set-policy writes when the selection is made/cleared). */
async function seedPolicy(policy: string, isBranch: number, rationale?: string): Promise<void> {
  await store.storeMutableKnowledge('PolicyChanges', 0, { Policy: policy, IsBranch: isBranch, Rationale: rationale } as any);
}

describe('get-options: Policy.Next framing', () => {
  it('renders a cleared selection as plain None and drops its rationale', async () => {
    await seedPolicy('None', 1, 'Branch completed');

    const result = await client.call({ PlayerID: 0 });
    expect(result.Policy).toEqual({ Next: 'None' });
  });

  it('reports None when the player has no stored policy selection', async () => {
    const result = await client.call({ PlayerID: 0 });
    expect(result.Policy).toEqual({ Next: 'None' });
  });

  it('keeps the pending branch selection framed with its rationale', async () => {
    await seedPolicy('Liberty', 1, 'expand');

    const result = await client.call({ PlayerID: 0 });
    expect(result.Policy).toEqual({ Next: 'Liberty (New Branch)', Rationale: 'expand' });
  });

  it('keeps the pending single-policy selection framed', async () => {
    await seedPolicy('Aristocracy', 0, 'tall');

    const result = await client.call({ PlayerID: 0 });
    expect(result.Policy).toEqual({ Next: 'Aristocracy (Policy)', Rationale: 'tall' });
  });
});
