/**
 * Tests for the pinned deal-schema helpers — focused on `symmetrizeDeal`, which completes mutual
 * agreements (Declaration of Friendship / Defensive Pact / Research Agreement / Peace Treaty) onto
 * both sides so a one-sided pact is never inspected or stored.
 */
import { describe, it, expect } from 'vitest';
import { symmetrizeDeal, SYMMETRIC_TRADE_ITEM_TYPES, type DealPayload, type TradeItem } from '../../../src/utils/deal-schema.js';

const deal = (items: TradeItem[]): DealPayload => ({ version: 1, items, promises: [] });

describe('SYMMETRIC_TRADE_ITEM_TYPES', () => {
  it('contains exactly the four mutual agreements', () => {
    expect([...SYMMETRIC_TRADE_ITEM_TYPES].sort()).toEqual(
      ['DECLARATION_OF_FRIENDSHIP', 'DEFENSIVE_PACT', 'PEACE_TREATY', 'RESEARCH_AGREEMENT']
    );
    expect(SYMMETRIC_TRADE_ITEM_TYPES.has('OPEN_BORDERS')).toBe(false);
    expect(SYMMETRIC_TRADE_ITEM_TYPES.has('GOLD')).toBe(false);
  });
});

describe('symmetrizeDeal', () => {
  it('appends the opposite-direction twin for a one-sided mutual agreement', () => {
    const out = symmetrizeDeal(deal([{ fromPlayerID: 1, toPlayerID: 3, itemType: 'DECLARATION_OF_FRIENDSHIP' }]));
    expect(out.items).toEqual([
      { fromPlayerID: 1, toPlayerID: 3, itemType: 'DECLARATION_OF_FRIENDSHIP' },
      { fromPlayerID: 3, toPlayerID: 1, itemType: 'DECLARATION_OF_FRIENDSHIP' },
    ]);
  });

  it('is idempotent — an already-symmetric pact is returned unchanged (same reference)', () => {
    const input = deal([
      { fromPlayerID: 1, toPlayerID: 3, itemType: 'DEFENSIVE_PACT' },
      { fromPlayerID: 3, toPlayerID: 1, itemType: 'DEFENSIVE_PACT' },
    ]);
    const out = symmetrizeDeal(input);
    expect(out).toBe(input);
    expect(out.items).toHaveLength(2);
  });

  it('leaves directional items (gold, open borders) untouched', () => {
    const input = deal([
      { fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', amount: 50 },
      { fromPlayerID: 1, toPlayerID: 3, itemType: 'OPEN_BORDERS' },
    ]);
    const out = symmetrizeDeal(input);
    expect(out).toBe(input);
    expect(out.items).toHaveLength(2);
  });

  it('completes multiple distinct pacts in one pass without mutating the input', () => {
    const input = deal([
      { fromPlayerID: 1, toPlayerID: 3, itemType: 'PEACE_TREATY' },
      { fromPlayerID: 1, toPlayerID: 3, itemType: 'RESEARCH_AGREEMENT' },
    ]);
    const out = symmetrizeDeal(input);
    expect(input.items).toHaveLength(2); // input not mutated
    expect(out.items).toHaveLength(4);
    expect(out.items).toEqual(expect.arrayContaining([
      { fromPlayerID: 3, toPlayerID: 1, itemType: 'PEACE_TREATY' },
      { fromPlayerID: 3, toPlayerID: 1, itemType: 'RESEARCH_AGREEMENT' },
    ]));
  });
});
