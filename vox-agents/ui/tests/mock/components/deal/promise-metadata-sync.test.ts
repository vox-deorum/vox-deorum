/**
 * Drift guard: the browser bundle keeps plain-literal copies of the promise vocabulary (it
 * deliberately avoids importing the mcp-server runtime, which pulls in zod), so this test pins those
 * copies to the canonical `PROMISE_METADATA` source of truth in deal-schema.ts. It runs under vitest
 * (node), where the mcp-server runtime + zod resolve via the workspace hoist — even though the same
 * import is intentionally absent from the browser build. If the offered set, labels, or targeting
 * ever diverge, this fails instead of the two surfaces silently drifting.
 */

import { describe, it, expect } from 'vitest';
import {
  PROMISE_TYPES as UI_PROMISE_TYPES,
  OFFERED_PROMISE_TYPES as UI_OFFERED_PROMISE_TYPES,
  PROMISE_LABELS as UI_PROMISE_LABELS,
  PROMISE_NEEDS_TARGET as UI_PROMISE_NEEDS_TARGET,
  TOGGLE_ITEMS as UI_TOGGLE_ITEMS,
  SYMMETRIC_ITEM_TYPES as UI_SYMMETRIC_ITEM_TYPES,
} from '@/components/deal/deal-helpers';
import {
  PROMISE_TYPES,
  PROMISE_METADATA,
  OFFERED_PROMISE_TYPES,
  TARGETED_PROMISE_TYPES,
  AGREEMENT_METADATA,
  SYMMETRIC_TRADE_ITEM_TYPES,
} from '../../../../../../mcp-server/dist/utils/deal-schema.js';

describe('UI promise vocabulary stays in sync with the canonical PROMISE_METADATA', () => {
  it('mirrors the full PROMISE_TYPES contract', () => {
    expect([...UI_PROMISE_TYPES]).toEqual([...PROMISE_TYPES]);
  });

  it('offers exactly the promises the tactical AI honors (OFFERED_PROMISE_TYPES)', () => {
    expect([...UI_OFFERED_PROMISE_TYPES].sort()).toEqual([...OFFERED_PROMISE_TYPES].sort());
  });

  it('uses the canonical promise labels for every promise type', () => {
    const canonical = Object.fromEntries(PROMISE_TYPES.map((t) => [t, PROMISE_METADATA[t].label]));
    expect(UI_PROMISE_LABELS).toEqual(canonical);
  });

  it('marks the same promises as needing a third-party target', () => {
    expect([...UI_PROMISE_NEEDS_TARGET].sort()).toEqual([...TARGETED_PROMISE_TYPES].sort());
  });
});

describe('UI agreement toggles stay in sync with the canonical AGREEMENT_METADATA', () => {
  it('mirrors the agreement item types, labels, and range keys (same order)', () => {
    expect(UI_TOGGLE_ITEMS.map((t) => ({ itemType: t.itemType, label: t.label, rangeKey: t.rangeKey }))).toEqual(
      AGREEMENT_METADATA.map((a) => ({ itemType: a.itemType, label: a.label, rangeKey: a.rangeKey }))
    );
  });

  it('marks the same agreements as mutual (symmetric)', () => {
    expect([...UI_SYMMETRIC_ITEM_TYPES].sort()).toEqual([...SYMMETRIC_TRADE_ITEM_TYPES].sort());
  });
});
