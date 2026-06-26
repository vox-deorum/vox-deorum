/**
 * Tests for the server-side deal renderer (src/utils/diplomacy/deal-format.ts): friendly item/promise
 * labels, the advisory "no usable estimate" sentinel, and the direction-grouped terms block the
 * diplomat/negotiator agents read. Pure — no mcp-client or game state.
 */

import { describe, it, expect } from 'vitest';
import {
  isSentinel,
  formatEstimate,
  formatSideValue,
  formatItemLabel,
  formatPromiseLabel,
  formatDealTermsByDirection,
  itemTypeLabel,
  SENTINEL_LABEL,
} from '../../../src/utils/diplomacy/deal-format.js';
import type { DealPayload, TradeItem } from '../../../../mcp-server/dist/utils/deal-schema.js';
import { PROMISE_METADATA } from '../../../../mcp-server/dist/utils/deal-schema.js';

const INT_MAX = 2147483647;

describe('isSentinel / formatEstimate', () => {
  it('flags INT_MAX-scale values and renders them as "no usable estimate"', () => {
    expect(isSentinel(INT_MAX)).toBe(true);
    expect(isSentinel(-INT_MAX)).toBe(true);
    expect(isSentinel(42)).toBe(false);
    expect(formatEstimate(INT_MAX)).toBe(SENTINEL_LABEL);
    expect(SENTINEL_LABEL).toBe('no usable estimate');
    expect(formatEstimate(42.6)).toBe('43');
  });
});

describe('formatSideValue', () => {
  it('frames a real estimate by civ and role', () => {
    expect(formatSideValue(50, 'Rome', 'receive')).toBe('worth 50 to Rome (receiving)');
    expect(formatSideValue(30, 'Germany', 'give')).toBe('worth 30 to Germany (giving)');
  });
  it('renders a sentinel as a no-usable-estimate phrase, and drops an absent value', () => {
    expect(formatSideValue(INT_MAX, 'Rome', 'give')).toBe('no usable estimate for Rome (giving)');
    expect(formatSideValue(INT_MAX, 'Rome', 'receive')).toBe('no usable estimate for Rome (receiving)');
    expect(formatSideValue(undefined, 'Rome', 'give')).toBe('');
  });
});

describe('formatItemLabel / itemTypeLabel / formatPromiseLabel', () => {
  it('labels item types with their data, falling back to IDs without a range', () => {
    expect(formatItemLabel({ fromPlayerID: 0, toPlayerID: 1, itemType: 'ALLOW_EMBASSY' } as TradeItem)).toBe('Allow Embassy');
    expect(formatItemLabel({ fromPlayerID: 0, toPlayerID: 1, itemType: 'GOLD', amount: 50 } as TradeItem)).toBe('Gold: 50');
    expect(
      formatItemLabel({ fromPlayerID: 0, toPlayerID: 1, itemType: 'RESOURCES', resourceID: 7, quantity: 2, duration: 30 } as TradeItem)
    ).toBe('Resource #7 ×2 (30t)');
    expect(formatItemLabel({ fromPlayerID: 0, toPlayerID: 1, itemType: 'CITIES', cityID: 4 } as TradeItem)).toBe('City #4');
    expect(itemTypeLabel('OPEN_BORDERS')).toBe('Open Borders');
  });
  it('labels promises in the promiser voice and resolves a third-party target name', () => {
    // Labels come from the canonical PROMISE_METADATA (single source of truth).
    expect(formatPromiseLabel({ promiserID: 0, recipientID: 1, promiseType: 'SPY' })).toBe(PROMISE_METADATA.SPY.label);
    expect(
      formatPromiseLabel({ promiserID: 0, recipientID: 1, promiseType: 'COOP_WAR', targetPlayerID: 5 }, { 5: 'Greece' })
    ).toBe(`${PROMISE_METADATA.COOP_WAR.label} (target: Greece)`);
  });
});

describe('formatDealTermsByDirection', () => {
  const civ = (id: number) => (id === 0 ? 'Rome' : 'Germany');
  const deal: DealPayload = {
    version: 1,
    items: [
      { fromPlayerID: 0, toPlayerID: 1, itemType: 'ALLOW_EMBASSY' },
      { fromPlayerID: 1, toPlayerID: 0, itemType: 'ALLOW_EMBASSY' },
    ],
    promises: [],
  };
  // Value1 → player1ID (0 = Rome): #0 giving maxed out, #1 receiving = 50.
  // Value2 → player2ID (1 = Germany): #0 receiving = 50, #1 giving = 50.
  const value1 = { '0': INT_MAX, '1': 50 };
  const value2 = { '0': 50, '1': 50 };

  it('groups by direction with civ names, viewer-first ordering, and the advisory sentinel', () => {
    const out = formatDealTermsByDirection(deal, value1, value2, 0, 1, civ, /* viewer */ 1);

    // Viewer (Germany) gives section comes first.
    expect(out).toContain('# Germany gives Rome');
    expect(out).toContain('- Allow Embassy: worth 50 to Rome (receiving); worth 50 to Germany (giving)');
    // Counterpart section; Rome's giver estimate maxed out → no usable estimate.
    expect(out).toContain('# Rome gives Germany');
    expect(out).toContain('- Allow Embassy: worth 50 to Germany (receiving); no usable estimate for Rome (giving)');
    // Advisory nature is stated exactly once, not repeated per line.
    expect(out).toContain('advisory');
    expect(out).not.toContain('2147483647');
    expect(out.split('Per-item values').length - 1).toBe(1);
  });

  it('omits value clauses (and the advisory note) when no snapshots are given', () => {
    const out = formatDealTermsByDirection(deal, undefined, undefined, 0, 1, civ, 1);
    expect(out).toContain('# Germany gives Rome');
    expect(out).toContain('- Allow Embassy');
    expect(out).not.toContain('worth');
    expect(out).not.toContain('advisory');
  });

  it('falls back to "Player <id>" when no civ name resolver value is available', () => {
    const out = formatDealTermsByDirection(deal, value1, value2, 0, 1, (id) => `Player ${id}`, 1);
    expect(out).toContain('# Player 1 gives Player 0');
  });

  it('renders promise-only direction blocks without an advisory note', () => {
    const promiseDeal: DealPayload = {
      version: 1,
      items: [],
      promises: [
        { promiserID: 1, recipientID: 0, promiseType: 'SPY' },
        { promiserID: 0, recipientID: 1, promiseType: 'COOP_WAR', targetPlayerID: 5 },
      ],
    };

    const out = formatDealTermsByDirection(promiseDeal, value1, value2, 0, 1, civ, 1);
    expect(out).toContain('# Germany promises Rome');
    expect(out).toContain(`- ${PROMISE_METADATA.SPY.label}`);
    expect(out).toContain('# Rome promises Germany');
    expect(out).toContain(`- ${PROMISE_METADATA.COOP_WAR.label} (target: player 5)`);
    expect(out).not.toContain('Per-item values');
  });
});
