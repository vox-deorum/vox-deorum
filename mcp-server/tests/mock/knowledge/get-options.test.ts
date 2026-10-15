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
import * as strategyLoader from '../../../src/utils/strategies/loader.js';
import { getTool } from '../../../src/tools/index.js';
import createGetOptionsTool from '../../../src/tools/knowledge/get-options.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { connectToolClient } from '../tool-client.js';

const tool = createGetOptionsTool();
const originalEconomicStrategy = enumMappings.EconomicStrategy;
const originalMilitaryStrategy = enumMappings.MilitaryStrategy;
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
  if (originalEconomicStrategy) enumMappings.EconomicStrategy = originalEconomicStrategy;
  else delete enumMappings.EconomicStrategy;
  if (originalMilitaryStrategy) enumMappings.MilitaryStrategy = originalMilitaryStrategy;
  else delete enumMappings.MilitaryStrategy;
  await store.close();
});

/** Seed this player's PolicyChanges row (what set-policy writes when the selection is made/cleared). */
async function seedPolicy(policy: string, isBranch: number, rationale?: string): Promise<void> {
  await store.storeMutableKnowledge('PolicyChanges', 0, { Policy: policy, IsBranch: isBranch, Rationale: rationale } as any);
}

describe('get-options: Policy.Next framing', () => {
  it('returns no rationale for a cleared policy selection', async () => {
    await seedPolicy('None', 1, 'Branch completed');

    const result = await client.call({ PlayerID: 0 });
    expect(result.Policy.Next).toBe('None');
    expect(result.Policy).not.toHaveProperty('Rationale');
  });

  it('returns no next policy when the player has no stored selection', async () => {
    const result = await client.call({ PlayerID: 0 });
    expect(result.Policy.Next).toBe('None');
    expect(result.Policy).not.toHaveProperty('Rationale');
  });

  it('returns a pending branch selection and its rationale', async () => {
    await seedPolicy('Liberty', 1, 'expand');

    const result = await client.call({ PlayerID: 0 });
    expect(result.Policy.Next).toContain('Liberty');
    expect(result.Policy.Rationale).toBe('expand');
  });

  it('returns a pending single-policy selection', async () => {
    await seedPolicy('Aristocracy', 0, 'tall');

    const result = await client.call({ PlayerID: 0 });
    expect(result.Policy.Next).toContain('Aristocracy');
    expect(result.Policy.Rationale).toBe('tall');
  });

  it('returns mode-specific current strategy and flavor data through MCP', async () => {
    enumMappings.EconomicStrategy = { 10: 'Growth' };
    enumMappings.MilitaryStrategy = { 20: 'Defense' };
    await store.storeMutableKnowledge('StrategyChanges', 0, {
      GrandStrategy: 'Capitalist',
      EconomicStrategies: ['Growth'],
      MilitaryStrategies: ['Defense'],
      Rationale: 'Protect the economy',
    } as any);
    // Writers always store every flavor, defaulting untouched ones to 50.
    const defaultFlavors = Object.fromEntries(Object.keys(await strategyLoader.loadFlavorDescriptions()).map(key => [key, 50]));
    await store.storeMutableKnowledge('FlavorChanges', 0, {
      ...defaultFlavors,
      GrandStrategy: 'Capitalist',
      Offense: 72,
      Defense: 48,
      Rationale: 'Prefer balanced engagements',
    } as any);
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
      success: true,
      result: [{
        PlayerID: 0,
        EconomicStrategies: [10],
        MilitaryStrategies: [20],
        Technologies: [],
        NextResearch: null,
        Policies: [],
        PolicyBranches: [],
        NextPolicy: null,
        NextBranch: null,
      }],
    } as any);
    vi.spyOn(strategyLoader, 'loadGrandStrategyDescriptions').mockResolvedValue({ Capitalist: 'Long-term direction' } as any);
    vi.spyOn(strategyLoader, 'loadFlavorDescriptions').mockResolvedValue({ Offense: 'Combat preference', Defense: 'Protection preference' } as any);
    vi.spyOn(getTool('getEconomicStrategy')!, 'getSummaries').mockResolvedValue([
      { Type: 'Growth', Description: 'Expand the economy' },
    ] as any);
    vi.spyOn(getTool('getMilitaryStrategy')!, 'getSummaries').mockResolvedValue([
      { Type: 'Defense', Description: 'Protect the empire' },
    ] as any);

    const strategy = await client.call({ PlayerID: 0, Mode: 'Strategy' });
    expect(strategy.Strategy).toMatchObject({
      GrandStrategy: 'Capitalist',
      EconomicStrategies: ['Growth'],
      MilitaryStrategies: ['Defense'],
      Rationale: 'Protect the economy',
    });
    expect(strategy.Options.EconomicStrategies).toHaveProperty('Growth');
    expect(strategy.Options.MilitaryStrategies).toHaveProperty('Defense');

    const flavor = await client.call({ PlayerID: 0, Mode: 'Flavor' });
    expect(flavor.Strategy).toMatchObject({
      GrandStrategy: 'Capitalist',
      Flavors: { Offense: 72, Defense: 48 },
      Rationale: 'Prefer balanced engagements',
    });
    expect(flavor.Options.Flavors).toMatchObject({ Offense: 'Combat preference' });
  });
});
