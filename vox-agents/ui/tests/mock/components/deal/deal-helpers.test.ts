import { describe, it, expect } from 'vitest';
import {
  isSentinel,
  formatValue,
  sideGives,
  formatItemLabel,
  formatPromiseLabel,
  computeSideBalance,
  type SideRange,
} from '@/components/deal/deal-helpers';
import type { TradeItem, PromiseTerm, InspectedTradeItem } from '@/utils/types';

const item = (over: Partial<TradeItem>): TradeItem => ({
  fromPlayerID: 0,
  toPlayerID: 1,
  itemType: 'GOLD',
  ...over,
});

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

  it('labels items, using the giver range for city names', () => {
    const range = { cities: [{ cityID: 7, name: 'Berlin', x: 1, y: 2 }] } as unknown as SideRange;
    expect(formatItemLabel(item({ itemType: 'GOLD', amount: 100 }))).toBe('Gold: 100');
    expect(formatItemLabel(item({ itemType: 'CITIES', cityID: 7 }), range)).toBe('City: Berlin');
    expect(formatItemLabel(item({ itemType: 'CITIES', cityID: 9 }), range)).toBe('City #9');
    expect(formatItemLabel(item({ itemType: 'OPEN_BORDERS' }))).toBe('Open Borders');
  });

  it('labels promises with their target for three-party promises', () => {
    const coop: PromiseTerm = { promiserID: 0, recipientID: 1, promiseType: 'COOP_WAR', targetPlayerID: 3 };
    const spy: PromiseTerm = { promiserID: 0, recipientID: 1, promiseType: 'SPY' };
    expect(formatPromiseLabel(coop)).toContain('target: player 3');
    expect(formatPromiseLabel(spy)).toBe('Stop spying on me');
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
