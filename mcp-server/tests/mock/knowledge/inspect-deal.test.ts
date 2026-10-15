/**
 * Tests for the read-only inspect-deal tool (interactive-diplomacy stage 3).
 *
 * The tool orchestrates Lua deal inspection and opinion/event enrichment. A controlled
 * bridge response exercises the MCP-visible result mapping without a live game or DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { getTool } from '../../../src/tools/index.js';
import createInspectDealTool, { type NormalizedSideRange } from '../../../src/tools/knowledge/inspect-deal.js';
import * as inspectDealUtil from '../../../src/utils/lua/inspect-deal.js';
import type { InspectDealResult, SideRange } from '../../../src/utils/lua/inspect-deal.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { connectToolClient } from '../tool-client.js';

const tool = createInspectDealTool();
let client: Awaited<ReturnType<typeof connectToolClient>>;
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
    .mockImplementation(async (args: any) => ({
      [args.PlayerID === 1 ? '3' : '1']: args.PlayerID === 1
        ? { OurOpinionOfThem: ['Wary from 1'], TheirOpinionOfUs: ['Friendly to 1'] }
        : { OurOpinionOfThem: ['Guarded from 3'], TheirOpinionOfUs: ['Unfriendly to 3'] },
    } as any));
  eventsSpy = vi
    .spyOn(getTool('getDiplomaticEvents')!, 'execute')
    .mockImplementation(async (args: any) => ({
      [`${args.PlayerID}->${args.OtherPlayerID}`]: [`event ${args.PlayerID} to ${args.OtherPlayerID}`],
    } as any));
  client = await connectToolClient(tool);
});

afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
  await store.close();
});

describe('inspect-deal', () => {
  it('rejects identical players', async () => {
    await expect(client.call({ PlayerAID: 1, PlayerBID: 1 } as any)).rejects.toThrow();
    expect(inspectSpy).not.toHaveBeenCalled();
  });

  it('returns the tradable range for an empty deal (no proposed terms)', async () => {
    const result = await client.call({ PlayerAID: 1, PlayerBID: 3 } as any);

    expect(result.items).toEqual([]);
    expect(result.promises).toEqual([]);
    expect(Object.keys(result.tradableRange)).toEqual(['1', '3']);
    expect((result.tradableRange['1'] as NormalizedSideRange).gold.available).toBe(true);
  });

  it('rejects trade items that are not between the inspected players', async () => {
    await expect(
      client.call({
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
      client.call({
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
      client.call({
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
    const result = await client.call({ PlayerAID: 1, PlayerBID: 3, ProposedDeal: deal } as any);

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
    const result = await client.call({ PlayerAID: 1, PlayerBID: 3, ProposedDeal: deal } as any);

    expect(result.items[0]).toMatchObject({
      legality: true,         // the sentinel value did NOT make a structurally-legal term illegal
      valueIfIGive: SENTINEL, // the sentinel surfaces unchanged and leaves caller-visible legality intact
      valueIfIReceive: 12,
    });
  });

  it('mirrors one-sided mutual agreements before Lua inspection', async () => {
    const deal = {
      version: 1,
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'DECLARATION_OF_FRIENDSHIP' }],
      promises: [],
    };

    inspectSpy.mockImplementation(async (_playerAID, _playerBID, items) => cannedResult({
      items: items.map((item) => ({
        ...item,
        legal: true,
        reason: '',
        valueToGiver: 10,
        valueToReceiver: 12,
      })),
    }));

    const result = await client.call({ PlayerAID: 1, PlayerBID: 3, ProposedDeal: deal });
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item: any) => [item.fromPlayerID, item.toPlayerID])).toEqual([
      [1, 3],
      [3, 1],
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

    const result = await client.call({
      PlayerAID: 1,
      PlayerBID: 3,
      ProposedDeal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'CITIES', cityID: 5 }], promises: [] },
    } as any);

    expect(result.items[0].legality).toBe(false);
    expect(result.items[0].reasons).toEqual(['You cannot trade your capital.', 'Reason two.']);
  });

  it('supplies a reason when an illegal item has no stock reason string', async () => {
    inspectSpy.mockResolvedValue(
      cannedResult({
        items: [
          { fromPlayerID: 1, toPlayerID: 3, itemType: 'TECHS', legal: false, reason: '', valueToGiver: 0, valueToReceiver: 0 },
        ],
      })
    );

    const result = await client.call({
      PlayerAID: 1,
      PlayerBID: 3,
      ProposedDeal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'TECHS', techID: 2 }], promises: [] },
    } as any);

    expect(result.items[0].reasons).toHaveLength(1);
    expect(result.items[0].reasons[0]).not.toBe('');
  });

  it('coerces range arrays that arrive as empty Lua objects', async () => {
    // Simulate the Lua/JSON boundary turning empty arrays into {} objects.
    const side = emptySide();
    (side as any).resources = {};
    (side as any).cities = {};
    inspectSpy.mockResolvedValue(cannedResult({ range: { '1': side, '3': emptySide() } }));

    const result = await client.call({ PlayerAID: 1, PlayerBID: 3 } as any);

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

    const result = await client.call({ PlayerAID: 1, PlayerBID: 3 } as any);

    expect(result.defaultDuration).toBe(45);
    expect(result.promiseTargets).toEqual([
      { playerID: 5, teamID: 5, name: 'Rome', kind: 'major', coopWarEligible: true },
      { playerID: 7, teamID: 7, name: 'Egypt', kind: 'major', coopWarEligible: false },
      { playerID: 22, teamID: 22, name: 'City-State Geneva', kind: 'minor', protectingPlayerIDs: [3] },
      { playerID: 9, teamID: 9, name: 'Greece', kind: 'major' },
    ]);
  });

  it('coerces an empty-object promiseTargets to an empty list', async () => {
    // The Lua/JSON boundary represents empty arrays as empty objects.
    const canned = cannedResult();
    (canned as any).promiseTargets = {};
    inspectSpy.mockResolvedValue(canned);

    const result = await client.call({ PlayerAID: 1, PlayerBID: 3 } as any);

    expect(result.promiseTargets).toEqual([]);
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

    const result = await client.call({ PlayerAID: 1, PlayerBID: 3 } as any);
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

    const result = await client.call({ PlayerAID: 1, PlayerBID: 3 } as any);
    const side = result.tradableRange['1'] as NormalizedSideRange;

    expect(side.openBorders).toEqual({ legal: true, reasons: [] });
    expect(side.defensivePact.legal).toBe(false);
    expect(side.defensivePact.reasons).toHaveLength(1);
    expect(side.defensivePact.reasons[0]).not.toBe('');
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

    const result = await client.call({ PlayerAID: 1, PlayerBID: 3 } as any);
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

    const result = await client.call({ PlayerAID: 1, PlayerBID: 3 } as any);
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

    const result = await client.call({ PlayerAID: 1, PlayerBID: 3 } as any);
    const side = result.tradableRange['1'] as NormalizedSideRange;

    expect(side.netGoldPerTurn).toBe(25);
    expect(side.resources[0]).toMatchObject({ valueToGiver: 60, valueToReceiver: 80 });
    expect(side.cities[0]).toMatchObject({ population: 8, hitPoints: 180, maxHitPoints: 200, valueToReceiver: 150 });
    expect(side.openBorders).toMatchObject({ valueToGiver: 10, valueToReceiver: 30 });
  });

  it('includes opinion and event context for each promise', async () => {
    const result = await client.call({
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
    expect(military.agreeabilityFactors.promiserOpinionOfRecipient).toEqual(['Wary from 1']);
    expect(military.agreeabilityFactors.recipientOpinionOfPromiser).toEqual(['Friendly to 1']);
    expect(military.agreeabilityFactors.recentDiplomaticEvents['1->3']).toEqual(['event 1 to 3']);
    expect(result.promises[2]).toMatchObject({ promiseType: 'COOP_WAR', promiserID: 1, targetPlayerID: 5 });
    expect(result.promises[3]).toMatchObject({
      promiseType: 'COOP_WAR',
      promiserID: 3,
      recipientID: 1,
      targetPlayerID: 5,
      agreeabilityFactors: {
        promiserOpinionOfRecipient: ['Guarded from 3'],
        recipientOpinionOfPromiser: ['Unfriendly to 3'],
        recentDiplomaticEvents: { '3->1': ['event 3 to 1'] },
      },
    });
  });

  it('throws when the game cannot inspect the deal (bridge failure)', async () => {
    inspectSpy.mockResolvedValue(null);
    await expect(client.call({ PlayerAID: 1, PlayerBID: 3 } as any)).rejects.toThrow();
  });

  it('passes the atWar and warLockTurns pair from the Lua result into the response', async () => {
    inspectSpy.mockResolvedValue(cannedResult({ atWar: true, warLockTurns: 3 }));

    const result = await client.call({ PlayerAID: 1, PlayerBID: 3 } as any);

    expect(result.atWar).toBe(true);
    expect(result.warLockTurns).toBe(3);
  });

  it('leaves atWar and warLockTurns undefined when the Lua result omits them', async () => {
    const result = await client.call({ PlayerAID: 1, PlayerBID: 3 } as any);

    expect(result.atWar).toBeUndefined();
    expect(result.warLockTurns).toBeUndefined();
  });
});

/**
 * Promise legality (stage 7.04 work item 4).
 *
 * The rules themselves live in `lua/inspect-deal.lua`'s shared validator and run against live game
 * state, which no mock tier can execute (this repo has no Lua harness — see the stage plan). What
 * IS pinned here is the contract across that boundary: the symmetrized promises reach the bridge
 * call, each rule's Lua verdict is merged onto the right promise by INDEX, and a Lua that answers
 * short or not at all degrades open. Each case is named for the rule whose verdict it carries.
 */
describe('inspect-deal promise legality', () => {
  /** Run an inspection whose Lua answer carries the given per-index promise verdicts. */
  async function inspectWithVerdicts(
    promises: unknown[],
    luaPromises: unknown
  ) {
    inspectSpy.mockResolvedValue(cannedResult({ promises: luaPromises } as any));
    return client.call({
      PlayerAID: 1,
      PlayerBID: 3,
      ProposedDeal: { version: 1, items: [], promises },
    } as any);
  }

  it('applies distinct bridge verdicts to both symmetrized promises', async () => {
    inspectSpy.mockImplementation(async (_playerAID, _playerBID, _items, promises) => cannedResult({
      promises: promises.map((promise) => ({
        legal: false,
        reason: `${promise.promiserID} to ${promise.recipientID}`,
      })),
    }));

    const result = await client.call({
      PlayerAID: 1,
      PlayerBID: 3,
      ProposedDeal: {
        version: 1,
        items: [],
        promises: [{ promiserID: 1, recipientID: 3, promiseType: 'COOP_WAR', targetPlayerID: 5 }],
      },
    });
    expect(result.promises).toHaveLength(2);
    expect(result.promises.map((promise: any) => ({
      promiserID: promise.promiserID,
      recipientID: promise.recipientID,
      legality: promise.legality,
      reasons: promise.reasons,
    }))).toEqual([
      { promiserID: 1, recipientID: 3, legality: false, reasons: ['1 to 3'] },
      { promiserID: 3, recipientID: 1, legality: false, reasons: ['3 to 1'] },
    ]);
  });

  // Both cases exercise the same index-merge of a refused verdict; the duplicate pair proves
  // the alignment (only the second promise is refused), the single-promise row shows the
  // verdict reaches its promise whatever the refused rule was.
  it.each([
    {
      rule: 'a duplicate logical commitment is illegal',
      promises: [
        { promiserID: 1, recipientID: 3, promiseType: 'MILITARY' },
        { promiserID: 1, recipientID: 3, promiseType: 'MILITARY' },
      ],
      verdicts: [{ legal: true, reason: '' }, { legal: false, reason: 'duplicate promise for this pair' }],
      merged: [{ legality: true, reasons: [] }, { legality: false, reasons: ['duplicate promise for this pair'] }],
    },
    {
      rule: 'promiser and recipient must be two distinct living majors and the deal principals',
      promises: [{ promiserID: 1, recipientID: 3, promiseType: 'MILITARY' }],
      verdicts: [{ legal: false, reason: 'promiser and recipient must be the two deal parties (distinct living majors)' }],
      merged: [{
        legality: false,
        reasons: ['promiser and recipient must be the two deal parties (distinct living majors)'],
      }],
    },
  ])('rule: $rule', async ({ promises, verdicts, merged }) => {
    const result = await inspectWithVerdicts(promises, verdicts);

    expect(result.promises).toHaveLength(merged.length);
    merged.forEach((expected, index) => {
      expect(result.promises[index]).toMatchObject(expected);
    });
  });

  it('rule exception: the two symmetrized Coop War twins are ONE commitment, both legal', async () => {
    const result = await inspectWithVerdicts(
      [{ promiserID: 1, recipientID: 3, promiseType: 'COOP_WAR', targetPlayerID: 5 }],
      [{ legal: true, reason: '' }, { legal: true, reason: '' }]
    );

    expect(result.promises).toHaveLength(2);
    expect(result.promises[0]).toMatchObject({ promiserID: 1, legality: true, reasons: [] });
    expect(result.promises[1]).toMatchObject({ promiserID: 3, legality: true, reasons: [] });
  });

  it('rule: COOP_WAR requires a valid third-party target', async () => {
    const result = await inspectWithVerdicts(
      [{ promiserID: 1, recipientID: 3, promiseType: 'COOP_WAR', targetPlayerID: 5 }],
      [
        { legal: false, reason: 'not a valid cooperative-war target (5)' },
        { legal: false, reason: 'not a valid cooperative-war target (5)' },
      ]
    );

    expect(result.promises.map((p) => p.legality)).toEqual([false, false]);
    expect(result.promises[0].reasons).toEqual(['not a valid cooperative-war target (5)']);
  });

  it('rule: MILITARY / EXPANSION / BORDER already in effect for the pair are illegal', async () => {
    const result = await inspectWithVerdicts(
      [
        { promiserID: 1, recipientID: 3, promiseType: 'MILITARY' },
        { promiserID: 1, recipientID: 3, promiseType: 'EXPANSION' },
        { promiserID: 1, recipientID: 3, promiseType: 'BORDER' },
      ],
      [
        { legal: false, reason: 'already in effect for this pair' },
        { legal: false, reason: 'already in effect for this pair' },
        { legal: false, reason: 'already in effect for this pair' },
      ]
    );

    expect(result.promises.map((p) => p.promiseType)).toEqual(['MILITARY', 'EXPANSION', 'BORDER']);
    for (const promise of result.promises) {
      expect(promise).toMatchObject({ legality: false, reasons: ['already in effect for this pair'] });
    }
  });

  it('supplies a fallback reason when an illegal promise carries no reason string', async () => {
    const result = await inspectWithVerdicts(
      [{ promiserID: 1, recipientID: 3, promiseType: 'MILITARY' }],
      [{ legal: false, reason: '' }]
    );

    expect(result.promises[0].reasons).toHaveLength(1);
    expect(result.promises[0].reasons[0]).not.toBe('');
  });

  it('degrades OPEN when the Lua returns no verdict for an index', async () => {
    // A short or absent promises list must never block an otherwise fine proposal.
    const short = await inspectWithVerdicts(
      [
        { promiserID: 1, recipientID: 3, promiseType: 'MILITARY' },
        { promiserID: 1, recipientID: 3, promiseType: 'EXPANSION' },
      ],
      [{ legal: false, reason: 'already in effect for this pair' }]
    );
    expect(short.promises[0].legality).toBe(false);
    expect(short.promises[1]).toMatchObject({ legality: true, reasons: [] });

    // An older script omits the field entirely; an empty Lua table arrives as {} rather than [].
    const absent = await inspectWithVerdicts(
      [{ promiserID: 1, recipientID: 3, promiseType: 'MILITARY' }],
      undefined
    );
    expect(absent.promises[0]).toMatchObject({ legality: true, reasons: [] });

    const emptyLuaTable = await inspectWithVerdicts(
      [{ promiserID: 1, recipientID: 3, promiseType: 'MILITARY' }],
      {}
    );
    expect(emptyLuaTable.promises[0]).toMatchObject({ legality: true, reasons: [] });
  });

  it('keeps agreeabilityFactors advisory and unchanged alongside a binding illegal verdict', async () => {
    const result = await inspectWithVerdicts(
      [{ promiserID: 1, recipientID: 3, promiseType: 'MILITARY' }],
      [{ legal: false, reason: 'already in effect for this pair' }]
    );

    expect(result.promises[0].legality).toBe(false);
    expect(result.promises[0].agreeabilityFactors.promiserOpinionOfRecipient).toEqual(['Wary from 1']);
  });
});
