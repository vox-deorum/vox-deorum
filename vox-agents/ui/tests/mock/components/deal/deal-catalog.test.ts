import { describe, it, expect } from 'vitest';
import {
  buildSideCatalog,
  defaultItemFor,
  durationFor,
  isSingletonSelected,
  offerItemsForSide,
  offerPromisesForSide,
  type InventoryCategory,
} from '@/components/deal/deal-catalog';
import type { NormalizedSideRange } from '@/components/deal/deal-helpers';
import type { TradeItem, PromiseTerm, PromiseTargetInfo } from '@/utils/types';

/** A normalized range fixture; override the parts a test cares about. */
const range = (over: Partial<NormalizedSideRange> = {}): NormalizedSideRange =>
  ({
    gold: { available: true, max: 500, reasons: [] },
    goldPerTurn: { available: true, reasons: [] },
    maps: { legal: true, reasons: [] },
    openBorders: { legal: true, reasons: [] },
    defensivePact: { legal: true, reasons: [] },
    researchAgreement: { legal: true, reasons: [] },
    peaceTreaty: { legal: true, reasons: [] },
    allowEmbassy: { legal: true, reasons: [] },
    declarationOfFriendship: { legal: true, reasons: [] },
    vassalage: { legal: true, reasons: [] },
    vassalageRevoke: { legal: true, reasons: [] },
    resources: [],
    cities: [],
    techs: [],
    thirdPartyPeace: [],
    thirdPartyWar: [],
    voteCommitments: [],
    ...over,
  }) as NormalizedSideRange;

const build = (over: Partial<Parameters<typeof buildSideCatalog>[0]> = {}): InventoryCategory[] =>
  buildSideCatalog({
    ownerID: 0,
    otherID: 1,
    range: range(),
    currentItems: [],
    currentPromises: [],
    defaultDuration: 30,
    peaceDuration: 10,
    relationshipDuration: 25,
    promiseTargets: [],
    ...over,
  });

const cat = (cats: InventoryCategory[], kind: string) => cats.find((c) => c.kind === kind)!;
const durations = { defaultDuration: 30, peaceDuration: 10, relationshipDuration: 25 };

describe('deal-catalog', () => {
  it('returns the categories in the in-game order (no bonus bucket — bonus resources are never tradeable)', () => {
    expect(build().map((c) => c.kind)).toEqual([
      'gold',
      'luxury',
      'strategic',
      'congress',
      'toggles',
      'cities',
      'techs',
      'thirdParty',
      'promises',
    ]);
    // Bonus resources are filtered out at the inspect-deal source, so there is no bucket for them.
    expect(build().some((c) => (c.kind as string) === 'bonus')).toBe(false);
  });

  it('buckets resources into luxury / strategic only (bonus is hidden upstream)', () => {
    const cats = build({
      range: range({
        resources: [
          { resourceID: 1, name: 'Wine', category: 'luxury', quantityAvailable: 2, legal: true, reasons: [] },
          { resourceID: 2, name: 'Iron', category: 'strategic', quantityAvailable: 5, legal: true, reasons: [] },
        ],
      }),
    });
    expect(cat(cats, 'luxury').rows.map((r) => r.label)).toEqual(['Wine']);
    expect(cat(cats, 'strategic').rows.map((r) => r.label)).toEqual(['Iron']);
    expect(cat(cats, 'strategic').rows[0]!.secondary).toBe('≤ 5');
  });

  it('keeps structurally impossible candidates (red, with reasons) rather than dropping them', () => {
    const cats = build({
      range: range({
        resources: [{ resourceID: 7, name: 'Oil', category: 'strategic', quantityAvailable: 0, legal: false, reasons: ['None available'] }],
      }),
    });
    const row = cat(cats, 'strategic').rows[0]!;
    expect(row.legal).toBe(false);
    expect(row.reasons).toEqual(['None available']);
    expect(row.addPayload!.kind).toBe('item');
  });

  it('marks an illegal toggle as not-legal but still present', () => {
    const cats = build({ range: range({ openBorders: { legal: false, reasons: ['No embassy'] } }) });
    const ob = cat(cats, 'toggles').rows.find((r) => r.key === 'OPEN_BORDERS')!;
    expect(ob.legal).toBe(false);
    expect(ob.reasons).toEqual(['No embassy']);
  });

  it('omits ruleset-gated toggles entirely when absent from the range (hidden, not red)', () => {
    // The inspect-deal source drops research-agreement / vassalage when the game option forbids
    // them, so the row must not appear at all — while a present-but-illegal toggle still renders.
    const gated = range();
    delete (gated as Partial<NormalizedSideRange>).researchAgreement;
    delete (gated as Partial<NormalizedSideRange>).vassalage;
    delete (gated as Partial<NormalizedSideRange>).vassalageRevoke;
    const keys = cat(build({ range: gated }), 'toggles').rows.map((r) => r.key);
    expect(keys).not.toContain('RESEARCH_AGREEMENT');
    expect(keys).not.toContain('VASSALAGE');
    expect(keys).not.toContain('VASSALAGE_REVOKE');
    // Non-gated toggles are unaffected.
    expect(keys).toContain('OPEN_BORDERS');
    expect(keys).toContain('PEACE_TREATY');
  });

  it('shows singletons already on the table as selected', () => {
    const currentItems: TradeItem[] = [{ fromPlayerID: 0, toPlayerID: 1, itemType: 'OPEN_BORDERS' }];
    const cats = build({ currentItems });
    const toggles = cat(cats, 'toggles').rows;
    expect(toggles.find((r) => r.key === 'OPEN_BORDERS')!.selected).toBe(true);
    expect(toggles.find((r) => r.key === 'DEFENSIVE_PACT')!.selected).toBe(false);
  });

  it('marks a specific resource selected only when that resource is on the table', () => {
    const cats = build({
      range: range({ resources: [{ resourceID: 2, name: 'Iron', category: 'strategic', quantityAvailable: 5, legal: true, reasons: [] }] }),
      currentItems: [{ fromPlayerID: 0, toPlayerID: 1, itemType: 'RESOURCES', resourceID: 2, quantity: 1 }],
    });
    expect(cat(cats, 'strategic').rows[0]!.selected).toBe(true);
  });

  it('isSingletonSelected only matches the owner side', () => {
    const items: TradeItem[] = [{ fromPlayerID: 1, toPlayerID: 0, itemType: 'MAPS' }];
    expect(isSingletonSelected('MAPS', 0, items)).toBe(false);
    expect(isSingletonSelected('MAPS', 1, items)).toBe(true);
  });

  it('surfaces only the offered promises; non-targeted add directly, Coop War expands to eligible civs', () => {
    const promiseTargets: PromiseTargetInfo[] = [
      { playerID: 3, teamID: 3, name: 'Washington', kind: 'major', coopWarEligible: true },
      { playerID: 4, teamID: 4, name: 'Napoleon', kind: 'major', coopWarEligible: false },
    ];
    const currentPromises: PromiseTerm[] = [
      { promiserID: 0, recipientID: 1, promiseType: 'MILITARY' },
      { promiserID: 0, recipientID: 1, promiseType: 'COOP_WAR', targetPlayerID: 3 },
    ];
    const rows = cat(build({ currentPromises, promiseTargets }), 'promises').rows;
    // Only the AI-honored promises are offered (MILITARY/EXPANSION/BORDER/NO_DIGGING/COOP_WAR).
    expect(rows.map((r) => r.key)).toEqual([
      'PROMISE:MILITARY',
      'PROMISE:EXPANSION',
      'PROMISE:BORDER',
      'PROMISE:NO_DIGGING',
      'PROMISE:COOP_WAR',
    ]);
    // The non-honored promises are not addable from the editor.
    for (const t of ['SPY', 'NO_CONVERT', 'BULLY_CITY_STATE', 'ATTACK_CITY_STATE']) {
      expect(rows.find((r) => r.key === `PROMISE:${t}`)).toBeUndefined();
    }

    // Non-targeted: a direct singleton-by-type, already pledged → selected.
    const military = rows.find((r) => r.key === 'PROMISE:MILITARY')!;
    expect(military.selected).toBe(true);
    expect(military.targets).toBeUndefined();
    expect(military.addPayload).toEqual({ kind: 'promise', promise: { promiserID: 0, recipientID: 1, promiseType: 'MILITARY' } });

    // Targeted: expandable, no direct add; targets from metadata with per-target eligibility/selected.
    const coop = rows.find((r) => r.key === 'PROMISE:COOP_WAR')!;
    expect(coop.addPayload).toBeUndefined();
    const wash = coop.targets!.find((t) => t.label === 'Washington')!;
    const napo = coop.targets!.find((t) => t.label === 'Napoleon')!;
    expect(wash.legal).toBe(true);
    expect(wash.selected).toBe(true); // COOP_WAR vs 3 already on the table
    expect(wash.addPayload).toEqual({ kind: 'promise', promise: { promiserID: 0, recipientID: 1, promiseType: 'COOP_WAR', targetPlayerID: 3 } });
    expect(napo.legal).toBe(false); // coopWarEligible === false → ineligible (but still shown)
  });

  it('builds third-party peace/war as expandable target rows', () => {
    const cats = build({
      range: range({
        thirdPartyPeace: [{ teamID: 4, name: 'Greece', legal: true, reasons: [] }],
        thirdPartyWar: [{ teamID: 5, name: 'Egypt', legal: false, reasons: ['Already at war'] }],
      }),
    });
    const rows = cat(cats, 'thirdParty').rows;
    expect(rows.map((r) => r.key)).toEqual(['TP_PEACE', 'TP_WAR']);

    const peace = rows.find((r) => r.key === 'TP_PEACE')!;
    expect(peace.addPayload).toBeUndefined();
    expect(peace.targets!.map((t) => t.label)).toEqual(['Greece']);
    expect(peace.targets![0]!.addPayload).toMatchObject({ kind: 'item', item: { itemType: 'THIRD_PARTY_PEACE', thirdPartyTeamID: 4 } });

    const war = rows.find((r) => r.key === 'TP_WAR')!;
    expect(war.targets![0]!.legal).toBe(false);
    expect(war.targets![0]!.reasons).toEqual(['Already at war']);
  });

  it('marks a third-party target selected when that team is already on the table', () => {
    const cats = build({
      range: range({ thirdPartyWar: [{ teamID: 5, name: 'Egypt', legal: true, reasons: [] }] }),
      currentItems: [{ fromPlayerID: 0, toPlayerID: 1, itemType: 'THIRD_PARTY_WAR', thirdPartyTeamID: 5 }],
    });
    const war = cat(cats, 'thirdParty').rows.find((r) => r.key === 'TP_WAR')!;
    expect(war.targets![0]!.selected).toBe(true);
  });

  it('expands World Congress into the enumerated resolutions, each carrying its full vote term', () => {
    const cats = build({
      range: range({
        voteCommitments: [
          { resolutionID: 5, voteChoice: 1, numVotes: 12, repeal: false, name: 'Embargo — Yes', legal: true, reasons: [] },
          { resolutionID: 8, voteChoice: 0, numVotes: 12, repeal: true, name: 'Repeal: Scholars', legal: false, reasons: ['Not enough votes'] },
        ],
      }),
    });
    const congress = cat(cats, 'congress').rows;
    expect(congress.map((r) => r.key)).toEqual(['VOTE_COMMITMENT']);

    const vote = congress[0]!;
    expect(vote.addPayload).toBeUndefined(); // expandable header, not a direct add
    expect(vote.targets!.map((t) => t.label)).toEqual(['Embargo — Yes', 'Repeal: Scholars']);
    // The picked term is fully formed (resolution, choice, game-computed votes, enact/repeal).
    expect(vote.targets![0]!.addPayload).toMatchObject({
      kind: 'item',
      item: { itemType: 'VOTE_COMMITMENT', resolutionID: 5, voteChoice: 1, numVotes: 12, repeal: false },
    });
    // Nothing on the table yet: the legal one is addable, the impossible one shows its own reason.
    expect(vote.targets![0]!.selected).toBe(false);
    expect(vote.targets![1]!.legal).toBe(false);
    expect(vote.targets![1]!.reasons).toEqual(['Not enough votes']);
  });

  it('blocks the other vote targets once the side has one vote commitment (DLL allows one per deal)', () => {
    const cats = build({
      range: range({
        voteCommitments: [
          { resolutionID: 5, voteChoice: 1, numVotes: 12, repeal: false, name: 'Embargo — Yes', legal: true, reasons: [] },
          { resolutionID: 8, voteChoice: 0, numVotes: 12, repeal: true, name: 'Repeal: Scholars', legal: true, reasons: [] },
        ],
      }),
      currentItems: [{ fromPlayerID: 0, toPlayerID: 1, itemType: 'VOTE_COMMITMENT', resolutionID: 5, voteChoice: 1, numVotes: 12, repeal: false }],
    });
    const targets = cat(cats, 'congress').rows[0]!.targets!;

    // The committed one is selected (shown "on the table"), still legal.
    expect(targets[0]).toMatchObject({ selected: true, legal: true });
    // Every other vote is blocked until the current one is removed.
    expect(targets[1]!.selected).toBe(false);
    expect(targets[1]!.legal).toBe(false);
    expect(targets[1]!.reasons).toEqual(['Only one vote commitment per deal — remove the current one first.']);
  });

  it('hides the World Congress category when no resolutions are in session', () => {
    expect(cat(build({ range: range({ voteCommitments: [] }) }), 'congress').rows).toHaveLength(0);
  });

  it('seeds default items: qty 1, the fixed duration, and gold capped at the range max', () => {
    expect(defaultItemFor('RESOURCES', 0, 1, { resourceID: 3, durations })).toEqual({
      fromPlayerID: 0,
      toPlayerID: 1,
      itemType: 'RESOURCES',
      resourceID: 3,
      quantity: 1,
      duration: 30,
    });
    expect(defaultItemFor('GOLD_PER_TURN', 0, 1, { durations })).toMatchObject({ amount: 1, duration: 30 });
    expect(defaultItemFor('GOLD_PER_TURN', 0, 1)).not.toHaveProperty('duration');
    // Gold seed is capped at what the side can actually offer.
    const lowGold = build({ range: range({ gold: { available: true, max: 40, reasons: [] } }) });
    const goldRow = cat(lowGold, 'gold').rows.find((r) => r.key === 'GOLD')!;
    expect(goldRow.addPayload).toMatchObject({ item: { itemType: 'GOLD', amount: 40 } });
    const highGold = cat(build(), 'gold').rows.find((r) => r.key === 'GOLD')!;
    expect(highGold.addPayload).toMatchObject({ item: { itemType: 'GOLD', amount: 100 } });
  });

  it('durationFor maps each item type to its fixed game duration (deal / peace / relationship / none)', () => {
    // Deal duration: tribute (gold-per-turn / resources) + Open Borders / Defensive Pact / Research Agreement.
    expect(durationFor('GOLD_PER_TURN', durations)).toBe(30);
    expect(durationFor('RESOURCES', durations)).toBe(30);
    expect(durationFor('OPEN_BORDERS', durations)).toBe(30);
    expect(durationFor('DEFENSIVE_PACT', durations)).toBe(30);
    expect(durationFor('RESEARCH_AGREEMENT', durations)).toBe(30);
    // Peace duration: peace treaty + third-party peace. Relationship duration: declaration of friendship.
    expect(durationFor('PEACE_TREATY', durations)).toBe(10);
    expect(durationFor('THIRD_PARTY_PEACE', durations)).toBe(10);
    expect(durationFor('DECLARATION_OF_FRIENDSHIP', durations)).toBe(25);
    // No-duration types.
    expect(durationFor('GOLD', durations)).toBeUndefined();
    expect(durationFor('MAPS', durations)).toBeUndefined();
    expect(durationFor('ALLOW_EMBASSY', durations)).toBeUndefined();
    // Peace / relationship fall back to the deal duration when their game-speed value is unavailable.
    expect(durationFor('PEACE_TREATY', { defaultDuration: 30, peaceDuration: undefined, relationshipDuration: undefined })).toBe(30);
    expect(durationFor('DECLARATION_OF_FRIENDSHIP', { defaultDuration: 30, peaceDuration: undefined, relationshipDuration: undefined })).toBe(30);
  });

  it('seeds each agreement toggle with its fixed game duration (deal / peace / relationship)', () => {
    const toggles = cat(build(), 'toggles').rows;
    const dur = (key: string) =>
      (toggles.find((r) => r.key === key)?.addPayload as { item: TradeItem } | undefined)?.item.duration;
    // Open Borders / Defensive Pact / Research Agreement run for the deal duration (30).
    expect(dur('OPEN_BORDERS')).toBe(30);
    expect(dur('DEFENSIVE_PACT')).toBe(30);
    expect(dur('RESEARCH_AGREEMENT')).toBe(30);
    // Peace Treaty → peace duration (10); Declaration of Friendship → relationship duration (25).
    expect(dur('PEACE_TREATY')).toBe(10);
    expect(dur('DECLARATION_OF_FRIENDSHIP')).toBe(25);
    // Allow Embassy / Maps / Vassalage carry no duration.
    expect(dur('ALLOW_EMBASSY')).toBeUndefined();
    expect(dur('MAPS')).toBeUndefined();

    // Third-party peace (an expandable target) also uses the peace duration.
    const peaceRange = range({ thirdPartyPeace: [{ teamID: 4, name: 'Greece', legal: true, reasons: [] }] });
    const tp = cat(build({ range: peaceRange }), 'thirdParty').rows.find((r) => r.key === 'TP_PEACE')!;
    expect((tp.targets![0]!.addPayload as { item: TradeItem }).item.duration).toBe(10);
  });

  it('maps offer rows back to their working-deal index per giver', () => {
    const items: TradeItem[] = [
      { fromPlayerID: 0, toPlayerID: 1, itemType: 'GOLD', amount: 1 },
      { fromPlayerID: 1, toPlayerID: 0, itemType: 'GOLD', amount: 2 },
      { fromPlayerID: 0, toPlayerID: 1, itemType: 'MAPS' },
    ];
    expect(offerItemsForSide(items, 0).map((e) => e.index)).toEqual([0, 2]);
    expect(offerItemsForSide(items, 1).map((e) => e.index)).toEqual([1]);

    const promises: PromiseTerm[] = [
      { promiserID: 1, recipientID: 0, promiseType: 'MILITARY' },
      { promiserID: 0, recipientID: 1, promiseType: 'EXPANSION' },
    ];
    expect(offerPromisesForSide(promises, 0).map((e) => e.index)).toEqual([1]);
    expect(offerPromisesForSide(promises, 1).map((e) => e.index)).toEqual([0]);
  });
});
