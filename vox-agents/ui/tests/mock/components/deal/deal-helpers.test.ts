import { describe, it, expect } from 'vitest';
import {
  isSentinel,
  formatValue,
  sideGives,
  formatItemLabel,
  formatPromiseLabel,
  computeSideBalance,
  type NormalizedSideRange,
} from '@/components/deal/deal-helpers';
import type { TradeItem, PromiseTerm, InspectedTradeItem, PromiseTargetInfo } from '@/utils/types';

const item = (over: Partial<TradeItem>): TradeItem => ({
  fromPlayerID: 0,
  toPlayerID: 1,
  itemType: 'GOLD',
  ...over,
});

/** A normalized range fixture carrying the game-facing names + per-candidate legality. */
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

describe('deal-helpers', () => {
  it('flags INT_MAX-scale sentinels and formats them as a dash', () => {
    expect(isSentinel(2147483647)).toBe(true);
    expect(isSentinel(-2147483647)).toBe(true);
    expect(isSentinel(42)).toBe(false);
    expect(formatValue(2147483647)).toBe('—');
    expect(formatValue(42.6)).toBe('43');
  });

  it('selects the items one side gives', () => {
    const items = [item({ fromPlayerID: 0 }), item({ fromPlayerID: 1 }), item({ fromPlayerID: 0, itemType: 'MAPS' })];
    const gives0 = sideGives(items, 0);
    expect(gives0.map((g) => g.index)).toEqual([0, 2]);
    expect(sideGives(items, 1).map((g) => g.index)).toEqual([1]);
  });

  it('labels items, using the giver range for game-facing names', () => {
    const r = range({
      cities: [{ cityID: 7, name: 'Berlin', x: 1, y: 2, legal: true, reasons: [] }],
      resources: [{ resourceID: 3, name: 'Iron', category: 'strategic', quantityAvailable: 5, legal: true, reasons: [] }],
      techs: [{ techID: 9, name: 'Steel', legal: true, reasons: [] }],
      thirdPartyPeace: [{ teamID: 4, name: 'Greece', legal: true, reasons: [] }],
    });
    expect(formatItemLabel(item({ itemType: 'GOLD', amount: 100 }))).toBe('Gold: 100');
    expect(formatItemLabel(item({ itemType: 'CITIES', cityID: 7 }), r)).toBe('City: Berlin');
    expect(formatItemLabel(item({ itemType: 'CITIES', cityID: 9 }), r)).toBe('City #9');
    expect(formatItemLabel(item({ itemType: 'RESOURCES', resourceID: 3, quantity: 2 }), r)).toBe('Iron ×2');
    expect(formatItemLabel(item({ itemType: 'TECHS', techID: 9 }), r)).toBe('Tech: Steel');
    expect(formatItemLabel(item({ itemType: 'THIRD_PARTY_PEACE', thirdPartyTeamID: 4 }), r)).toBe('Peace with Greece');
    expect(formatItemLabel(item({ itemType: 'OPEN_BORDERS' }))).toBe('Open Borders');
  });

  it('falls back to numeric ids when a name cannot be resolved', () => {
    expect(formatItemLabel(item({ itemType: 'RESOURCES', resourceID: 8, quantity: 1 }))).toBe('Resource #8 ×1');
    expect(formatItemLabel(item({ itemType: 'TECHS', techID: 2 }))).toBe('Tech #2');
    expect(formatItemLabel(item({ itemType: 'THIRD_PARTY_WAR', thirdPartyTeamID: 6 }))).toBe('War with team 6');
  });

  it('labels promises and resolves a target display name when metadata is supplied', () => {
    const coop: PromiseTerm = { promiserID: 0, recipientID: 1, promiseType: 'COOP_WAR', targetPlayerID: 3 };
    const spy: PromiseTerm = { promiserID: 0, recipientID: 1, promiseType: 'SPY' };
    const targets: PromiseTargetInfo[] = [{ playerID: 3, teamID: 3, name: 'Washington', kind: 'major' }];
    expect(formatPromiseLabel(coop)).toContain('target: player 3');
    expect(formatPromiseLabel(coop, targets)).toContain('target: Washington');
    expect(formatPromiseLabel(spy)).toBe("Won't spy on you");
  });

  it('labels a vote commitment with the resolution name + vote count from the giver range', () => {
    const r = range({
      voteCommitments: [
        { resolutionID: 5, voteChoice: 1, numVotes: 12, repeal: false, name: 'Embargo — Yes', legal: true, reasons: [] },
      ],
    });
    const vote = item({ itemType: 'VOTE_COMMITMENT', resolutionID: 5, voteChoice: 1, numVotes: 12, repeal: false });
    expect(formatItemLabel(vote, r)).toBe('Vote: Embargo — Yes (12 votes)');
    // Falls back to the bare resolution id when the range has no matching entry.
    expect(formatItemLabel(item({ itemType: 'VOTE_COMMITMENT', resolutionID: 9, voteChoice: 0, numVotes: 1, repeal: false }), r)).toBe(
      'Vote: resolution 9 (1 vote)'
    );
  });

  it('sums the net value to a side from per-item values, excluding sentinels', () => {
    const items = [
      item({ fromPlayerID: 0, toPlayerID: 1 }), // player 0 gives → costs player 0
      item({ fromPlayerID: 1, toPlayerID: 0 }), // player 0 receives → gains player 0
      item({ fromPlayerID: 0, toPlayerID: 1 }), // sentinel give → excluded, flagged
    ];
    const inspected: InspectedTradeItem[] = [
      { fromPlayerID: 0, toPlayerID: 1, itemType: 'GOLD', legality: true, reasons: [], valueIfIGive: 30, valueIfIReceive: 25 },
      { fromPlayerID: 1, toPlayerID: 0, itemType: 'GOLD', legality: true, reasons: [], valueIfIGive: 40, valueIfIReceive: 50 },
      { fromPlayerID: 0, toPlayerID: 1, itemType: 'CITIES', legality: true, reasons: [], valueIfIGive: 2147483647, valueIfIReceive: 0 },
    ];
    const b = computeSideBalance(items, inspected, 0);
    // receives 50 (item 1), gives 30 (item 0); item 2 give is a sentinel → excluded + flagged.
    expect(b.net).toBe(20);
    expect(b.hasSentinel).toBe(true);
  });
});
