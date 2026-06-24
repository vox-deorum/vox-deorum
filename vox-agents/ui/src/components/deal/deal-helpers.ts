/**
 * Pure helpers for the Web deal screen (interactive-diplomacy stage 4): the trade-item
 * vocabulary, per-term display formatting using the game-facing names `inspect-deal` now
 * returns, sentinel-aware value formatting, and the other-side value balance summed from
 * `inspect-deal`'s per-item values.
 *
 * Kept free of Vue/DOM so it can be unit-tested directly. The component holds the reactive
 * editing state and wires these into the template. The categorized inventory model lives in
 * the sibling `deal-catalog.ts`.
 */

import type {
  TradeItem,
  PromiseTerm,
  InspectedTradeItem,
  NormalizedSideRange,
  PromiseTargetInfo,
} from '@/utils/types';

/**
 * The tradable range one side could put on the table, as `inspect-deal` returns it. This is
 * now the tool-owned normalized shape (display names, resource category, per-candidate
 * legality + reason lines); re-exported here so component/test imports have one canonical name.
 */
export type { NormalizedSideRange } from '@/utils/types';

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

/**
 * Human-readable promise labels, phrased in the promiser's voice (what the offering side pledges
 * toward the other side) so they read correctly on both the inventory row and the central offer.
 */
export const PROMISE_LABELS: Record<string, string> = {
  MILITARY: "Won't attack / will move troops away",
  EXPANSION: "Won't settle near you",
  BORDER: "Won't buy plots near your cities",
  NO_CONVERT: "Won't spread my religion to you",
  NO_DIGGING: "Won't dig your antiquity sites",
  SPY: "Won't spy on you",
  BULLY_CITY_STATE: "Won't bully your protected city-state",
  ATTACK_CITY_STATE: "Won't attack your protected city-state",
  COOP_WAR: 'Will join a cooperative war',
};

/** Promise types that require a third-party target. */
export const PROMISE_NEEDS_TARGET = new Set(['COOP_WAR', 'BULLY_CITY_STATE', 'ATTACK_CITY_STATE']);

/**
 * Single-shot trade-item toggles (no extra data), in the in-game category order
 * (embassy, open borders, pacts, friendship, maps, peace, then vassalage). Each maps to a
 * `CandidateLegality` slot on `NormalizedSideRange`, so the inventory can show it red with a
 * reason when structurally impossible rather than hiding it.
 */
export const TOGGLE_ITEMS: Array<{ itemType: TradeItem['itemType']; label: string; rangeKey: keyof NormalizedSideRange }> = [
  { itemType: 'ALLOW_EMBASSY', label: 'Allow Embassy', rangeKey: 'allowEmbassy' },
  { itemType: 'OPEN_BORDERS', label: 'Open Borders', rangeKey: 'openBorders' },
  { itemType: 'DEFENSIVE_PACT', label: 'Defensive Pact', rangeKey: 'defensivePact' },
  { itemType: 'RESEARCH_AGREEMENT', label: 'Research Agreement', rangeKey: 'researchAgreement' },
  { itemType: 'DECLARATION_OF_FRIENDSHIP', label: 'Declaration of Friendship', rangeKey: 'declarationOfFriendship' },
  { itemType: 'MAPS', label: 'Maps', rangeKey: 'maps' },
  { itemType: 'PEACE_TREATY', label: 'Peace Treaty', rangeKey: 'peaceTreaty' },
  { itemType: 'VASSALAGE', label: 'Vassalage', rangeKey: 'vassalage' },
  { itemType: 'VASSALAGE_REVOKE', label: 'Revoke Vassalage', rangeKey: 'vassalageRevoke' },
];

/**
 * Trade items the game treats as **mutual**: they always sit on BOTH sides at once (the in-game
 * trade screen pairs them automatically). The editor mirrors them on add/remove so a friendship /
 * pact / peace is never one-sided; the backend auto-completes the same way (`symmetrizeDeal` in
 * deal-schema.ts). Duplicated here as a plain set so the browser bundle needn't import the
 * mcp-server runtime (mirrors the `PROMISE_TYPES` duplication above).
 */
export const SYMMETRIC_ITEM_TYPES = new Set<TradeItem['itemType']>([
  'DECLARATION_OF_FRIENDSHIP',
  'DEFENSIVE_PACT',
  'RESEARCH_AGREEMENT',
  'PEACE_TREATY',
]);

/** The opposite-direction twin of a (symmetric) item: the same term with giver/receiver swapped. */
export function mirrorItem(item: TradeItem): TradeItem {
  return { ...item, fromPlayerID: item.toPlayerID, toPlayerID: item.fromPlayerID };
}

/** Whether `candidate` is `item`'s opposite-direction twin (same type, swapped from/to). */
function isMirrorItem(candidate: TradeItem, item: TradeItem): boolean {
  return (
    candidate.itemType === item.itemType &&
    candidate.fromPlayerID === item.toPlayerID &&
    candidate.toPlayerID === item.fromPlayerID
  );
}

/** Whether `items` already holds `item`'s opposite-direction twin (same type, swapped from/to). */
export function hasMirror(items: TradeItem[], item: TradeItem): boolean {
  return items.some((i) => isMirrorItem(i, item));
}

/** Add an item, auto-adding its opposite-direction twin when the term is mutual. */
export function addItemWithMirror(items: TradeItem[], item: TradeItem): TradeItem[] {
  const next = [...items, item];
  return SYMMETRIC_ITEM_TYPES.has(item.itemType) && !hasMirror(next, item)
    ? [...next, mirrorItem(item)]
    : next;
}

/** Remove an item, auto-removing its opposite-direction twin when the term is mutual. */
export function removeItemWithMirror(items: TradeItem[], index: number): TradeItem[] {
  const removed = items[index];
  if (!removed) return items;
  const next = items.filter((_, i) => i !== index);
  if (!SYMMETRIC_ITEM_TYPES.has(removed.itemType)) return next;
  const twin = next.findIndex((item) => isMirrorItem(item, removed));
  return twin < 0 ? next : next.filter((_, i) => i !== twin);
}

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

/** Items one side gives in a deal (the side is the `from` party), paired with their deal index. */
export function sideGives(items: TradeItem[], sideID: number): Array<{ item: TradeItem; index: number }> {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.fromPlayerID === sideID);
}

/** Resolve a resource's display name from the giver's range, falling back to its ID. */
function resourceName(resourceID: number | undefined, range?: NormalizedSideRange): string {
  const found = range?.resources.find((r) => r.resourceID === resourceID);
  return found?.name ?? `Resource #${resourceID}`;
}

/**
 * A short human label for a trade item, using the giver's range for game-facing names.
 *
 * `amountInEditor` is for the central offer, where the amount/quantity lives in an inline input and
 * the fixed duration is rendered as a trailing "× N turns": the three editor-bearing types
 * (GOLD, GOLD_PER_TURN, RESOURCES) then return a bare prefix ("Gold:", "Gold:", "<name>:") so the
 * value isn't shown twice — and Gold/turn drops the "/turn" since the "× N turns" already says it.
 * It implies `omitDuration` for those types. Every other (read-only) caller omits it and gets the
 * full "Gold: 100" / "Iron ×2 (30t)" form.
 */
export function formatItemLabel(
  item: TradeItem,
  range?: NormalizedSideRange,
  opts?: { omitDuration?: boolean; amountInEditor?: boolean }
): string {
  // Fixed duration suffix shown for every duration-bearing item, unless the caller renders the
  // duration elsewhere (the central offer shows it on the editor line for Gold/turn & Resources).
  const dur = !opts?.omitDuration && item.duration ? ` (${item.duration}t)` : '';
  switch (item.itemType) {
    case 'GOLD':
      return opts?.amountInEditor ? 'Gold:' : `Gold: ${item.amount ?? 0}`;
    case 'GOLD_PER_TURN':
      // In the central offer the per-turn nature is carried by the trailing "× N turns", so the
      // prefix is just "Gold:"; the read-only callers keep the explicit "Gold/turn: N".
      return opts?.amountInEditor ? 'Gold:' : `Gold/turn: ${item.amount ?? 0}${dur}`;
    case 'RESOURCES':
      return opts?.amountInEditor
        ? `${resourceName(item.resourceID, range)}:`
        : `${resourceName(item.resourceID, range)} ×${item.quantity ?? 0}${dur}`;
    case 'CITIES': {
      const city = range?.cities.find((c) => c.cityID === item.cityID);
      return city ? `City: ${city.name}` : `City #${item.cityID}`;
    }
    case 'TECHS': {
      const tech = range?.techs.find((t) => t.techID === item.techID);
      return tech?.name ? `Tech: ${tech.name}` : `Tech #${item.techID}`;
    }
    case 'THIRD_PARTY_PEACE': {
      const team = range?.thirdPartyPeace.find((t) => t.teamID === item.thirdPartyTeamID);
      return `Peace with ${team?.name ?? `team ${item.thirdPartyTeamID}`}${dur}`;
    }
    case 'THIRD_PARTY_WAR': {
      const team = range?.thirdPartyWar.find((t) => t.teamID === item.thirdPartyTeamID);
      return `War with ${team?.name ?? `team ${item.thirdPartyTeamID}`}`;
    }
    case 'VOTE_COMMITMENT': {
      const vote = range?.voteCommitments.find(
        (v) => v.resolutionID === item.resolutionID && v.voteChoice === item.voteChoice && v.repeal === !!item.repeal
      );
      const name = vote?.name ?? `resolution ${item.resolutionID}`;
      const votes = item.numVotes ?? vote?.numVotes;
      return `Vote: ${name}${votes !== undefined ? ` (${votes} ${votes === 1 ? 'vote' : 'votes'})` : ''}`;
    }
    default: {
      const toggle = TOGGLE_ITEMS.find((t) => t.itemType === item.itemType);
      return (toggle ? toggle.label : item.itemType) + dur;
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

/**
 * A promise term's display label. When `targets` is supplied a three-party promise resolves
 * its target's game-facing name (Coop War major / city-state minor); otherwise it falls back
 * to the bare target player ID.
 */
export function formatPromiseLabel(promise: PromiseTerm, targets?: PromiseTargetInfo[]): string {
  const base = PROMISE_LABELS[promise.promiseType] ?? promise.promiseType;
  if (PROMISE_NEEDS_TARGET.has(promise.promiseType) && promise.targetPlayerID !== undefined) {
    const target = targets?.find((t) => t.playerID === promise.targetPlayerID);
    const name = target?.name ?? `player ${promise.targetPlayerID}`;
    return `${base} (target: ${name})`;
  }
  return base;
}
