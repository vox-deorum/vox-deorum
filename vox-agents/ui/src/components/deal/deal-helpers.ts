/**
 * Pure helpers for the Web deal screen (interactive-diplomacy stage 4): the trade-item
 * vocabulary, per-term display formatting, sentinel-aware value formatting, and the
 * other-side value balance summed from `inspect-deal`'s per-item values.
 *
 * Kept free of Vue/DOM so it can be unit-tested directly. The component holds the
 * reactive editing state and wires these into the template.
 */

import type { TradeItem, PromiseTerm, InspectedTradeItem } from '@/utils/types';

/** The tradable range one side could put on the table, as `inspect-deal` returns it. */
export interface SideRange {
  gold: { available: boolean; max: number };
  goldPerTurn: { available: boolean };
  maps: boolean;
  openBorders: boolean;
  defensivePact: boolean;
  researchAgreement: boolean;
  peaceTreaty: boolean;
  allowEmbassy: boolean;
  declarationOfFriendship: boolean;
  vassalage: boolean;
  vassalageRevoke: boolean;
  resources: Array<{ resourceID: number; quantityAvailable: number }>;
  cities: Array<{ cityID: number; name: string; x: number; y: number }>;
  techs: Array<{ techID: number }>;
  thirdPartyPeace: Array<{ teamID: number }>;
  thirdPartyWar: Array<{ teamID: number }>;
}

/**
 * The nine promises tradeable on the agent path (specs §3). Mirrors the pinned
 * `PROMISE_TYPES` vocabulary; kept here as a plain list so the browser bundle needn't
 * import the mcp-server runtime module.
 */
export const PROMISE_TYPES = [
  'MILITARY',
  'EXPANSION',
  'BORDER',
  'NO_CONVERT',
  'NO_DIGGING',
  'SPY',
  'BULLY_CITY_STATE',
  'ATTACK_CITY_STATE',
  'COOP_WAR',
] as const;

/** Human-readable promise labels. */
export const PROMISE_LABELS: Record<string, string> = {
  MILITARY: "Won't attack / move troops away",
  EXPANSION: "Don't settle near me",
  BORDER: "Don't buy plots near my cities",
  NO_CONVERT: "Don't spread religion",
  NO_DIGGING: "Don't dig my antiquity sites",
  SPY: 'Stop spying on me',
  BULLY_CITY_STATE: 'Stop bullying my protected city-state',
  ATTACK_CITY_STATE: "Don't attack my protected city-state",
  COOP_WAR: 'Join / honor a cooperative war',
};

/** Promise types that require a third-party target. */
export const PROMISE_NEEDS_TARGET = new Set(['COOP_WAR', 'BULLY_CITY_STATE', 'ATTACK_CITY_STATE']);

/** Trade-item types that carry no extra data — a single "Add" toggle each, gated by the range. */
export const TOGGLE_ITEMS: Array<{ itemType: TradeItem['itemType']; label: string; rangeKey: keyof SideRange }> = [
  { itemType: 'OPEN_BORDERS', label: 'Open Borders', rangeKey: 'openBorders' },
  { itemType: 'DEFENSIVE_PACT', label: 'Defensive Pact', rangeKey: 'defensivePact' },
  { itemType: 'RESEARCH_AGREEMENT', label: 'Research Agreement', rangeKey: 'researchAgreement' },
  { itemType: 'PEACE_TREATY', label: 'Peace Treaty', rangeKey: 'peaceTreaty' },
  { itemType: 'MAPS', label: 'Maps', rangeKey: 'maps' },
  { itemType: 'ALLOW_EMBASSY', label: 'Allow Embassy', rangeKey: 'allowEmbassy' },
  { itemType: 'DECLARATION_OF_FRIENDSHIP', label: 'Declaration of Friendship', rangeKey: 'declarationOfFriendship' },
  { itemType: 'VASSALAGE', label: 'Vassalage', rangeKey: 'vassalage' },
  { itemType: 'VASSALAGE_REVOKE', label: 'Revoke Vassalage', rangeKey: 'vassalageRevoke' },
];

/**
 * The AI valuation returns an INT_MAX sentinel for anti-exploit guards (last strategic
 * resource, last luxury while unhappy) and "impossible" items. These surface in estimates
 * but gate nothing (specs §4) — we flag them rather than fold them into a total.
 */
const SENTINEL_THRESHOLD = 1e9;

/** True when an advisory value is a sentinel rather than a real estimate. */
export function isSentinel(value: number): boolean {
  return !Number.isFinite(value) || Math.abs(value) >= SENTINEL_THRESHOLD;
}

/** Format an advisory value for display: a sentinel shows as a dash, else a signed integer. */
export function formatValue(value: number): string {
  if (isSentinel(value)) return '—';
  return Math.round(value).toString();
}

/** Items one side gives in a deal (the side is the `from` party). */
export function sideGives(items: TradeItem[], sideID: number): Array<{ item: TradeItem; index: number }> {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.fromPlayerID === sideID);
}

/** A short human label for a trade item, using the giver's range for names where available. */
export function formatItemLabel(item: TradeItem, range?: SideRange): string {
  switch (item.itemType) {
    case 'GOLD':
      return `Gold: ${item.amount ?? 0}`;
    case 'GOLD_PER_TURN':
      return `Gold/turn: ${item.amount ?? 0}${item.duration ? ` (${item.duration}t)` : ''}`;
    case 'RESOURCES':
      return `Resource #${item.resourceID} ×${item.quantity ?? 0}${item.duration ? ` (${item.duration}t)` : ''}`;
    case 'CITIES': {
      const city = range?.cities.find((c) => c.cityID === item.cityID);
      return city ? `City: ${city.name}` : `City #${item.cityID}`;
    }
    case 'TECHS':
      return `Tech #${item.techID}`;
    case 'THIRD_PARTY_PEACE':
      return `Third-party peace (team ${item.thirdPartyTeamID})`;
    case 'THIRD_PARTY_WAR':
      return `Third-party war (team ${item.thirdPartyTeamID})`;
    case 'VOTE_COMMITMENT':
      return `Vote commitment (resolution ${item.resolutionID})`;
    default: {
      const toggle = TOGGLE_ITEMS.find((t) => t.itemType === item.itemType);
      return toggle ? toggle.label : item.itemType;
    }
  }
}

/**
 * The net value of a deal to one side, summed from `inspect-deal`'s per-item values
 * (specs §3 — the other-side total value balance, recomputed live as the deal is edited).
 * For each term the side receives we add its value-to-receiver; for each it gives we
 * subtract its value-to-giver. Sentinel-valued items are excluded and flagged.
 *
 * `inspected` is index-aligned with `items` (the server preserves order).
 */
export function computeSideBalance(
  items: TradeItem[],
  inspected: InspectedTradeItem[],
  sideID: number
): { net: number; hasSentinel: boolean } {
  let net = 0;
  let hasSentinel = false;
  items.forEach((item, index) => {
    const insp = inspected[index];
    if (!insp) return;
    if (item.toPlayerID === sideID) {
      if (isSentinel(insp.valueIfIReceive)) hasSentinel = true;
      else net += insp.valueIfIReceive;
    } else if (item.fromPlayerID === sideID) {
      if (isSentinel(insp.valueIfIGive)) hasSentinel = true;
      else net -= insp.valueIfIGive;
    }
  });
  return { net, hasSentinel };
}

/**
 * The net value of a deal to one side from the **stored** proposal-time per-item snapshots
 * (Payload.Value1 → Player1ID, Payload.Value2 → Player2ID), keyed by item index. Each entry
 * already encodes that item's value from the side's perspective (give vs. receive), so the
 * net is: + for items the side receives, − for items it gives. Sentinels are excluded/flagged.
 * Used by the inline deal card, which has the snapshots but does not re-inspect live.
 */
export function storedBalanceToSide(
  items: TradeItem[],
  value1: Record<string, number> | undefined,
  value2: Record<string, number> | undefined,
  player1ID: number,
  player2ID: number,
  sideID: number
): { net: number; hasSentinel: boolean } | undefined {
  const valueMap = sideID === player1ID ? value1 : sideID === player2ID ? value2 : undefined;
  if (!valueMap) return undefined;
  let net = 0;
  let hasSentinel = false;
  items.forEach((item, index) => {
    const v = valueMap[String(index)];
    if (v === undefined) return;
    if (isSentinel(v)) { hasSentinel = true; return; }
    if (item.toPlayerID === sideID) net += v;
    else if (item.fromPlayerID === sideID) net -= v;
  });
  return { net, hasSentinel };
}

/** A promise term's display label, including its target for three-party promises. */
export function formatPromiseLabel(promise: PromiseTerm): string {
  const base = PROMISE_LABELS[promise.promiseType] ?? promise.promiseType;
  if (PROMISE_NEEDS_TARGET.has(promise.promiseType) && promise.targetPlayerID !== undefined) {
    return `${base} (target: player ${promise.targetPlayerID})`;
  }
  return base;
}
