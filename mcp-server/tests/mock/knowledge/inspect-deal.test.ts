/**
 * Tests for the read-only inspect-deal tool (interactive-diplomacy stage 3).
 *
 * The tool orchestrates three collaborators: the inspectDeal Lua util (the bridge
 * boundary that builds a transient scratch deal in-game) and the get-opinions /
 * get-diplomatic-events tools (for promise agreeability factors). We stub all three
 * and assert the tool's marshalling, reason normalization, value passthrough, array
 * coercion, and per-promiser caching — without a live bridge, DLL, or DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { getTool } from '../../../src/tools/index.js';
import createInspectDealTool, { type NormalizedSideRange } from '../../../src/tools/knowledge/inspect-deal.js';
import * as inspectDealUtil from '../../../src/utils/lua/inspect-deal.js';
import type { InspectDealResult, SideRange } from '../../../src/utils/lua/inspect-deal.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createInspectDealTool();
let store: KnowledgeStore;
let inspectSpy: ReturnType<typeof vi.spyOn>;
let opinionsSpy: ReturnType<typeof vi.spyOn>;
let eventsSpy: ReturnType<typeof vi.spyOn>;

/** A minimal valid (raw) SideRange with everything off / empty. */
function emptySide(overrides: Partial<SideRange> = {}): SideRange {
  const off = { legal: false, reason: '' };
  return {
    gold: { available: true, max: 100, reason: '' },
    goldPerTurn: { available: true, reason: '' },
    maps: { ...off },
    openBorders: { ...off },
    defensivePact: { ...off },
    researchAgreement: { ...off },
    peaceTreaty: { ...off },
    allowEmbassy: { ...off },
    declarationOfFriendship: { ...off },
    vassalage: { ...off },
    vassalageRevoke: { ...off },
    resources: [],
    cities: [],
    techs: [],
    thirdPartyPeace: [],
    thirdPartyWar: [],
    voteCommitments: [],
    ...overrides,
  };
}

/** Build the default Lua inspection response with targeted overrides. */
function cannedResult(overrides: Partial<InspectDealResult> = {}): InspectDealResult {
  return {
    items: [],
    range: { '1': emptySide(), '3': emptySide() },
    defaultDuration: 30,
    promiseTargets: [],
    ...overrides,
  };
}

beforeEach(async () => {
  store = await setupStore(42);
  inspectSpy = vi.spyOn(inspectDealUtil, 'inspectDeal').mockResolvedValue(cannedResult());
  opinionsSpy = vi
    .spyOn(getTool('getOpinions')!, 'execute')
    .mockResolvedValue({ '3': { OurOpinionOfThem: ['Wary'], TheirOpinionOfUs: ['Friendly'] } } as any);
  eventsSpy = vi
    .spyOn(getTool('getDiplomaticEvents')!, 'execute')
    .mockResolvedValue({ '40': ['**Civ1** made peace with **Civ3**'] } as any);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

describe('inspect-deal', () => {
  it('rejects identical players', async () => {
    await expect(tool.execute({ PlayerAID: 1, PlayerBID: 1 } as any)).rejects.toThrow(/distinct/);
  });

  it('returns the tradable range for an empty deal (no proposed terms)', async () => {
    const result = await tool.execute({ PlayerAID: 1, PlayerBID: 3 } as any);

    // Lua util called with an empty item list.
    expect(inspectSpy).toHaveBeenCalledWith(1, 3, []);
    expect(result.items).toEqual([]);
    expect(result.promises).toEqual([]);
    expect(Object.keys(result.tradableRange)).toEqual(['1', '3']);
    expect((result.tradableRange['1'] as NormalizedSideRange).gold.available).toBe(true);
  });

  it('rejects trade items that are not between the inspected players', async () => {
    await expect(
      tool.execute({
        PlayerAID: 1,
        PlayerBID: 3,
        ProposedDeal: {
          version: 1,
          items: [{ fromPlayerID: 1, toPlayerID: 4, itemType: 'GOLD', amount: 25 }],
          promises: [],
        },
      } as any)
    ).rejects.toThrow(/items\[0\]/);

    expect(inspectSpy).not.toHaveBeenCalled();
  });

  it('rejects promises that are not between the inspected players', async () => {
    await expect(
      tool.execute({
        PlayerAID: 1,
        PlayerBID: 3,
        ProposedDeal: {
          version: 1,
          items: [],
          promises: [{ promiserID: 4, recipientID: 3, promiseType: 'MILITARY' }],
        },
      } as any)
    ).rejects.toThrow(/promises\[0\]/);

    expect(inspectSpy).not.toHaveBeenCalled();
    expect(opinionsSpy).not.toHaveBeenCalled();
    expect(eventsSpy).not.toHaveBeenCalled();
  });

  it('rejects city trade items without a resolvable city identifier', async () => {
    await expect(
      tool.execute({
        PlayerAID: 1,
        PlayerBID: 3,
        ProposedDeal: {
          version: 1,
          items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'CITIES' }],
          promises: [],
        },
      } as any)
    ).rejects.toThrow(/cityID/);

    expect(inspectSpy).not.toHaveBeenCalled();
  });

  it('maps a legal trade item to legality + both-direction value, with no reasons', async () => {
    inspectSpy.mockResolvedValue(
      cannedResult({
        items: [
          {
            fromPlayerID: 1,
            toPlayerID: 3,
            itemType: 'GOLD',
            legal: true,
            reason: '',
            valueToGiver: 100,
            valueToReceiver: 95,
          },
        ],
      })
    );

    const deal = { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', amount: 100 }], promises: [] };
    const result = await tool.execute({ PlayerAID: 1, PlayerBID: 3, ProposedDeal: deal } as any);

    expect(inspectSpy).toHaveBeenCalledWith(1, 3, deal.items);
    expect(result.items[0]).toMatchObject({
      itemType: 'GOLD',
      legality: true,
      reasons: [],
      valueIfIGive: 100,
      valueIfIReceive: 95,
    });
  });

  it('passes an INT_MAX-scale sentinel value through unchanged without flipping legality', async () => {
    // The CvDealAI anti-exploit guards (last strategic-resource copy, last luxury while unhappy)
    // return an INT_MAX-scale value. On the agent path this is advisory only (specs §4): it must
    // SURFACE in the estimate but never make a structurally-legal term illegal.
    const SENTINEL = 2147483647; // INT_MAX
    inspectSpy.mockResolvedValue(
      cannedResult({
        items: [
          {
            fromPlayerID: 1,
            toPlayerID: 3,
            itemType: 'GOLD',
            legal: true,
            reason: '',
            valueToGiver: SENTINEL,
            valueToReceiver: 12,
          },
        ],
      })
    );

    const deal = { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', amount: 100 }], promises: [] };
    const result = await tool.execute({ PlayerAID: 1, PlayerBID: 3, ProposedDeal: deal } as any);

    expect(result.items[0]).toMatchObject({
      legality: true,         // the sentinel value did NOT make a structurally-legal term illegal
      valueIfIGive: SENTINEL, // the sentinel surfaces unchanged (advisory; gates nothing)
      valueIfIReceive: 12,
    });
  });

  it('mirrors one-sided mutual agreements before Lua inspection', async () => {
    const deal = {
      version: 1,
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'DECLARATION_OF_FRIENDSHIP' }],
      promises: [],
    };

    await tool.execute({ PlayerAID: 1, PlayerBID: 3, ProposedDeal: deal } as any);

    expect(inspectSpy).toHaveBeenCalledWith(1, 3, [
      { fromPlayerID: 1, toPlayerID: 3, itemType: 'DECLARATION_OF_FRIENDSHIP' },
      { fromPlayerID: 3, toPlayerID: 1, itemType: 'DECLARATION_OF_FRIENDSHIP' },
    ]);
  });

  it('normalizes DLL reason tags into discrete reason lines for an illegal item', async () => {
    inspectSpy.mockResolvedValue(
      cannedResult({
        items: [
          {
            fromPlayerID: 1,
            toPlayerID: 3,
            itemType: 'CITIES',
            legal: false,
            reason: '[COLOR_NEGATIVE_TEXT]You cannot trade your capital.[ENDCOLOR][NEWLINE][NEWLINE]Reason two.',
            valueToGiver: 0,
            valueToReceiver: 0,
          },
        ],
      })
    );

    const result = await tool.execute({
      PlayerAID: 1,
      PlayerBID: 3,
      ProposedDeal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'CITIES', cityID: 5 }], promises: [] },
    } as any);

    expect(result.items[0].legality).toBe(false);
    expect(result.items[0].reasons).toEqual(['You cannot trade your capital.', 'Reason two.']);
  });

  it('supplies a fallback reason when an illegal item has no stock reason string', async () => {
    inspectSpy.mockResolvedValue(
      cannedResult({
        items: [
          { fromPlayerID: 1, toPlayerID: 3, itemType: 'TECHS', legal: false, reason: '', valueToGiver: 0, valueToReceiver: 0 },
        ],
      })
    );

    const result = await tool.execute({
      PlayerAID: 1,
      PlayerBID: 3,
      ProposedDeal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'TECHS', techID: 2 }], promises: [] },
    } as any);

    expect(result.items[0].reasons).toHaveLength(1);
    expect(result.items[0].reasons[0]).toMatch(/no specific reason/i);
  });

  it('coerces range arrays that arrive as empty Lua objects', async () => {
    // Simulate the Lua/JSON boundary turning empty arrays into {} objects.
    const side = emptySide();
    (side as any).resources = {};
    (side as any).cities = {};
    inspectSpy.mockResolvedValue(cannedResult({ range: { '1': side, '3': emptySide() } }));

    const result = await tool.execute({ PlayerAID: 1, PlayerBID: 3 } as any);

    expect((result.tradableRange['1'] as NormalizedSideRange).resources).toEqual([]);
    expect((result.tradableRange['1'] as NormalizedSideRange).cities).toEqual([]);
  });

  it('passes through the default deal duration and eligible promise targets with eligibility', async () => {
    inspectSpy.mockResolvedValue(
      cannedResult({
        defaultDuration: 45,
        promiseTargets: [
          // Major coop-war targets carry structural eligibility; minors carry the protectors.
          { playerID: 5, teamID: 5, name: 'Rome', kind: 'major', coopWarEligible: true },
          { playerID: 7, teamID: 7, name: 'Egypt', kind: 'major', coopWarEligible: false },
          { playerID: 22, teamID: 22, name: 'City-State Geneva', kind: 'minor', protectingPlayerIDs: [3] },
          // A coop-war eligibility absent (older DLL) survives as undefined.
          { playerID: 9, teamID: 9, name: 'Greece', kind: 'major' },
        ],
      })
    );

    const result = await tool.execute({ PlayerAID: 1, PlayerBID: 3 } as any);

    expect(result.defaultDuration).toBe(45);
    expect(result.promiseTargets).toEqual([
      { playerID: 5, teamID: 5, name: 'Rome', kind: 'major', coopWarEligible: true },
      { playerID: 7, teamID: 7, name: 'Egypt', kind: 'major', coopWarEligible: false },
      { playerID: 22, teamID: 22, name: 'City-State Geneva', kind: 'minor', protectingPlayerIDs: [3] },
      { playerID: 9, teamID: 9, name: 'Greece', kind: 'major' },
    ]);
  });

  it('coerces an empty-object promiseTargets (empty Lua table) so the output schema validates', async () => {
    // The Lua/JSON boundary turns an empty array into {}; left uncoerced it would fail the
    // z.array(PromiseTargetSchema) output schema the MCP layer enforces on the result.
    const canned = cannedResult();
    (canned as any).promiseTargets = {};
    inspectSpy.mockResolvedValue(canned);

    const result = await tool.execute({ PlayerAID: 1, PlayerBID: 3 } as any);

    expect(result.promiseTargets).toEqual([]);
    // Reproduce the MCP output validation path that was failing before the coercion.
    expect(() => tool.outputSchema.parse(result)).not.toThrow();
  });

  it('enriches resource candidates with name, category, and normalized legality', async () => {
    inspectSpy.mockResolvedValue(
      cannedResult({
        range: {
          '1': emptySide({
            resources: [
              { resourceID: 0, name: 'Iron', category: 'strategic', quantityAvailable: 3, legal: true, reason: '' },
              {
                resourceID: 1,
                name: 'Silk',
                category: 'luxury',
                quantityAvailable: 1,
                legal: false,
                reason: '[COLOR_NEGATIVE_TEXT]They already have this luxury.[ENDCOLOR]',
              },
            ],
          }),
          '3': emptySide(),
        },
      })
    );

    const result = await tool.execute({ PlayerAID: 1, PlayerBID: 3 } as any);
    const resources = (result.tradableRange['1'] as NormalizedSideRange).resources;

    expect(resources[0]).toMatchObject({ resourceID: 0, name: 'Iron', category: 'strategic', legal: true, reasons: [] });
    // A structurally-impossible resource is KEPT (not dropped) and carries its reason.
    expect(resources[1]).toMatchObject({ resourceID: 1, name: 'Silk', category: 'luxury', legal: false });
    expect(resources[1].reasons).toEqual(['They already have this luxury.']);
  });

  it('normalizes toggle candidates and supplies a fallback reason when the DLL is silent', async () => {
    inspectSpy.mockResolvedValue(
      cannedResult({
        range: {
          '1': emptySide({
            openBorders: { legal: true, reason: '' },
            // Illegal but with no stock reason string → fallback line, mirroring items.
            defensivePact: { legal: false, reason: '' },
          }),
          '3': emptySide(),
        },
      })
    );

    const result = await tool.execute({ PlayerAID: 1, PlayerBID: 3 } as any);
    const side = result.tradableRange['1'] as NormalizedSideRange;

    expect(side.openBorders).toEqual({ legal: true, reasons: [] });
    expect(side.defensivePact.legal).toBe(false);
    expect(side.defensivePact.reasons).toHaveLength(1);
    expect(side.defensivePact.reasons[0]).toMatch(/no specific reason/i);
  });

  it('keeps ruleset-gated toggles ABSENT (hidden, not red) when the Lua omits them', async () => {
    // When a game option forbids the whole category, the Lua leaves the field unset; the
    // normalizer must NOT materialize it as a red candidate — it stays absent so the board and
    // negotiator hide it (distinct from a present-but-illegal toggle that should show red).
    const side = emptySide();
    delete (side as Partial<SideRange>).researchAgreement;
    delete (side as Partial<SideRange>).vassalage;
    delete (side as Partial<SideRange>).vassalageRevoke;
    inspectSpy.mockResolvedValue(cannedResult({ range: { '1': side, '3': emptySide() } }));

    const result = await tool.execute({ PlayerAID: 1, PlayerBID: 3 } as any);
    const normalized = result.tradableRange['1'] as NormalizedSideRange;

    expect(normalized.researchAgreement).toBeUndefined();
    expect(normalized.vassalage).toBeUndefined();
    expect(normalized.vassalageRevoke).toBeUndefined();
    // A non-gated toggle the Lua still emits is normalized as usual (present, red here).
    expect(normalized.openBorders.legal).toBe(false);
  });

  it('keeps impossible city / tech / third-party candidates with their reasons', async () => {
    inspectSpy.mockResolvedValue(
      cannedResult({
        range: {
          '1': emptySide({
            cities: [
              { cityID: 7, name: 'Berlin', x: 1, y: 2, legal: false, reason: 'You cannot trade your capital.' },
            ],
            techs: [{ techID: 4, name: 'Pottery', legal: true, reason: '' }],
            thirdPartyWar: [{ teamID: 2, name: 'Egypt', legal: false, reason: 'You are already at war.' }],
            voteCommitments: [
              { resolutionID: 5, voteChoice: 1, numVotes: 12, repeal: false, name: 'Embargo — Yes', legal: true, reason: '' },
              { resolutionID: 8, voteChoice: 0, numVotes: 12, repeal: true, name: 'Repeal: Scholars', legal: false, reason: 'You have no spare votes.' },
            ],
          }),
          '3': emptySide(),
        },
      })
    );

    const result = await tool.execute({ PlayerAID: 1, PlayerBID: 3 } as any);
    const side = result.tradableRange['1'] as NormalizedSideRange;

    expect(side.cities[0]).toMatchObject({ cityID: 7, name: 'Berlin', legal: false });
    expect(side.cities[0].reasons).toEqual(['You cannot trade your capital.']);
    expect(side.techs[0]).toMatchObject({ techID: 4, name: 'Pottery', legal: true, reasons: [] });
    expect(side.thirdPartyWar[0]).toMatchObject({ teamID: 2, name: 'Egypt', legal: false });
    expect(side.thirdPartyWar[0].reasons).toEqual(['You are already at war.']);
    expect(side.voteCommitments[0]).toMatchObject({ resolutionID: 5, voteChoice: 1, numVotes: 12, repeal: false, name: 'Embargo — Yes', legal: true, reasons: [] });
    expect(side.voteCommitments[1]).toMatchObject({ resolutionID: 8, repeal: true, legal: false });
    expect(side.voteCommitments[1].reasons).toEqual(['You have no spare votes.']);
  });

  it('passes through advisory values, net income, and city population/HP', async () => {
    inspectSpy.mockResolvedValue(
      cannedResult({
        range: {
          '1': emptySide({
            netGoldPerTurn: 25,
            resources: [{ resourceID: 7, name: 'Iron', category: 'strategic', quantityAvailable: 4, legal: true, reason: '', valueToGiver: 60, valueToReceiver: 80 }],
            cities: [{ cityID: 4, name: 'Berlin', x: 1, y: 2, legal: true, reason: '', population: 8, hitPoints: 180, maxHitPoints: 200, valueToGiver: 300, valueToReceiver: 150 }],
            openBorders: { legal: true, reason: '', valueToGiver: 10, valueToReceiver: 30 },
          } as any),
          '3': emptySide(),
        },
      })
    );

    const result = await tool.execute({ PlayerAID: 1, PlayerBID: 3 } as any);
    const side = result.tradableRange['1'] as NormalizedSideRange;

    expect(side.netGoldPerTurn).toBe(25);
    expect(side.resources[0]).toMatchObject({ valueToGiver: 60, valueToReceiver: 80 });
    expect(side.cities[0]).toMatchObject({ population: 8, hitPoints: 180, maxHitPoints: 200, valueToReceiver: 150 });
    expect(side.openBorders).toMatchObject({ valueToGiver: 10, valueToReceiver: 30 });
  });

  it('assembles promise agreeability factors and fetches getters once per promiser', async () => {
    const result = await tool.execute({
      PlayerAID: 1,
      PlayerBID: 3,
      ProposedDeal: {
        version: 1,
        items: [],
        promises: [
          { promiserID: 1, recipientID: 3, promiseType: 'MILITARY' },
          { promiserID: 1, recipientID: 3, promiseType: 'NO_DIGGING' },
          { promiserID: 1, recipientID: 3, promiseType: 'COOP_WAR', targetPlayerID: 5 },
        ],
      },
    } as any);

    // Coop War is mutual: symmetrizeDeal completes the opposite-directed twin (promiser 3) before
    // inspection, so the three authored promises become four.
    expect(result.promises).toHaveLength(4);
    const military = result.promises[0];
    expect(military.promiseType).toBe('MILITARY');
    expect(military.agreeabilityFactors.promiserOpinionOfRecipient).toEqual(['Wary']);
    expect(military.agreeabilityFactors.recipientOpinionOfPromiser).toEqual(['Friendly']);
    expect(military.agreeabilityFactors.recentDiplomaticEvents).toEqual({ '40': ['**Civ1** made peace with **Civ3**'] });
    expect(result.promises[2]).toMatchObject({ promiseType: 'COOP_WAR', promiserID: 1, targetPlayerID: 5 });
    expect(result.promises[3]).toMatchObject({ promiseType: 'COOP_WAR', promiserID: 3, targetPlayerID: 5 });

    // Getters are cached per promiser: promiser 1 (three promises) and the coop-war twin's promiser 3.
    expect(opinionsSpy).toHaveBeenCalledTimes(2);
    expect(opinionsSpy).toHaveBeenCalledWith({ PlayerID: 1 });
    expect(opinionsSpy).toHaveBeenCalledWith({ PlayerID: 3 });
    expect(eventsSpy).toHaveBeenCalledTimes(2);
    expect(eventsSpy).toHaveBeenCalledWith({ PlayerID: 1, OtherPlayerID: 3, Formatted: true });
    expect(eventsSpy).toHaveBeenCalledWith({ PlayerID: 3, OtherPlayerID: 1, Formatted: true });
  });

  it('throws when the game cannot inspect the deal (bridge failure)', async () => {
    inspectSpy.mockResolvedValue(null);
    await expect(tool.execute({ PlayerAID: 1, PlayerBID: 3 } as any)).rejects.toThrow(/could not inspect/);
  });
});
