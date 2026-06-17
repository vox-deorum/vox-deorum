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
import createInspectDealTool from '../../../src/tools/knowledge/inspect-deal.js';
import * as inspectDealUtil from '../../../src/utils/lua/inspect-deal.js';
import type { InspectDealResult, SideRange } from '../../../src/utils/lua/inspect-deal.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createInspectDealTool();
let store: KnowledgeStore;
let inspectSpy: ReturnType<typeof vi.spyOn>;
let opinionsSpy: ReturnType<typeof vi.spyOn>;
let eventsSpy: ReturnType<typeof vi.spyOn>;

/** A minimal valid SideRange with everything off / empty. */
function emptySide(overrides: Partial<SideRange> = {}): SideRange {
  return {
    gold: { available: true, max: 100 },
    goldPerTurn: { available: true },
    maps: false,
    openBorders: false,
    defensivePact: false,
    researchAgreement: false,
    peaceTreaty: false,
    allowEmbassy: false,
    declarationOfFriendship: false,
    vassalage: false,
    vassalageRevoke: false,
    resources: [],
    cities: [],
    techs: [],
    thirdPartyPeace: [],
    thirdPartyWar: [],
    ...overrides,
  };
}

/** Build the default Lua inspection response with targeted overrides. */
function cannedResult(overrides: Partial<InspectDealResult> = {}): InspectDealResult {
  return {
    items: [],
    range: { '1': emptySide(), '3': emptySide() },
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
    expect((result.tradableRange['1'] as SideRange).gold.available).toBe(true);
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

    expect((result.tradableRange['1'] as SideRange).resources).toEqual([]);
    expect((result.tradableRange['1'] as SideRange).cities).toEqual([]);
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
          { promiserID: 1, recipientID: 3, promiseType: 'SPY' },
          { promiserID: 1, recipientID: 3, promiseType: 'COOP_WAR', targetPlayerID: 5 },
        ],
      },
    } as any);

    expect(result.promises).toHaveLength(3);
    const military = result.promises[0];
    expect(military.promiseType).toBe('MILITARY');
    expect(military.agreeabilityFactors.promiserOpinionOfRecipient).toEqual(['Wary']);
    expect(military.agreeabilityFactors.recipientOpinionOfPromiser).toEqual(['Friendly']);
    expect(military.agreeabilityFactors.recentDiplomaticEvents).toEqual({ '40': ['**Civ1** made peace with **Civ3**'] });
    expect(result.promises[2].targetPlayerID).toBe(5);

    // Same promiser/recipient across all three promises → one getter call each (cached).
    expect(opinionsSpy).toHaveBeenCalledTimes(1);
    expect(opinionsSpy).toHaveBeenCalledWith({ PlayerID: 1 });
    expect(eventsSpy).toHaveBeenCalledTimes(1);
    expect(eventsSpy).toHaveBeenCalledWith({ PlayerID: 1, OtherPlayerID: 3, Formatted: true });
  });

  it('throws when the game cannot inspect the deal (bridge failure)', async () => {
    inspectSpy.mockResolvedValue(null);
    await expect(tool.execute({ PlayerAID: 1, PlayerBID: 3 } as any)).rejects.toThrow(/could not inspect/);
  });
});
