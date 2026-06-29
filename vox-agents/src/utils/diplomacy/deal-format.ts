/**
 * @module utils/diplomacy/deal-format
 *
 * Server-side rendering of a stored deal into the direction-grouped, civ-named block the diplomat
 * and negotiator agents read (interactive-diplomacy stage 5). One section per giver→receiver
 * direction ("# <Giver> gives <Receiver>:"), with friendly item labels and the per-item value
 * snapshots framed "to <civ> (giving|receiving)".
 *
 * The per-item values are the stock trade AI's ADVISORY estimates — read-only, and never a gate on
 * the agent path (specs §4). `GetTradeItemValue` returns an INT_MAX sentinel when its estimate maxes
 * out (it would refuse the trade); that is NOT structural impossibility (a separate `IsPossibleToTradeItem`
 * check) and it binds nothing here, so a sentinel renders as "no usable estimate" and the advisory
 * nature is stated once via {@link ADVISORY_NOTE}.
 *
 * This is the browser-free twin of `ui/src/components/deal/deal-helpers.ts` (which renders the same
 * vocabulary for the web deal board); the toggle/promise labels and the sentinel wording are kept in
 * sync between the two. Types come straight from the pinned deal contract.
 */

import {
  AGREEMENT_METADATA,
  PROMISE_METADATA,
  TARGETED_PROMISE_TYPES,
} from "../../../../mcp-server/dist/utils/deal-schema.js";
import type {
  TradeItem,
  PromiseTerm,
  DealPayload,
  PerItemValueMap,
} from "../../../../mcp-server/dist/utils/deal-schema.js";

/**
 * The AI valuation returns an INT_MAX-scale sentinel when its advisory estimate maxes out (last
 * strategic resource, last luxury while unhappy, a category/policy refusal, …). It is advisory and
 * gates nothing — we surface it as "no usable estimate" rather than fold it into anything.
 */
const SENTINEL_THRESHOLD = 1e9;

/** Bare phrase for a sentinel (maxed-out) advisory estimate; mirrors the web twin's `SENTINEL_LABEL`. */
export const SENTINEL_LABEL = "no usable estimate";

/**
 * Stated once, clearly, above the per-item values so the reader knows they are advisory (and what a
 * "no usable estimate" means). Kept on the agent path because the stock AI valuation never binds it.
 */
export const ADVISORY_NOTE =
  'Per-item values are the in-game AI\'s advisory estimates, for your reference only.';

/** True when an advisory value is a sentinel (maxed out) rather than a real estimate. */
export function isSentinel(value: number): boolean {
  return !Number.isFinite(value) || Math.abs(value) >= SENTINEL_THRESHOLD;
}

/**
 * Render a bare advisory estimate: a rounded integer, or {@link SENTINEL_LABEL} when the value maxed
 * out. For callers that already supply their own "to <civ>" framing (e.g. the negotiator inspection).
 */
export function formatEstimate(value: number): string {
  return isSentinel(value) ? SENTINEL_LABEL : Math.round(value).toString();
}

/**
 * One per-item value clause for the direction-grouped block: `worth <n> to <civ> (giving|receiving)`,
 * or `no usable estimate for <civ> (giving|receiving)` when the estimate maxed out. Returns "" when
 * the value is absent (the caller drops the clause), e.g. a promise-only or pre-snapshot proposal.
 */
export function formatSideValue(
  value: number | undefined,
  civName: string,
  role: "give" | "receive"
): string {
  if (value === undefined) return "";
  const roleWord = role === "give" ? "giving" : "receiving";
  return isSentinel(value)
    ? `no usable estimate for ${civName} (${roleWord})`
    : `worth ${Math.round(value)} to ${civName} (${roleWord})`;
}

/**
 * Friendly base label per item type. The single-shot toggles mirror `TOGGLE_ITEMS` in the web twin;
 * the data-bearing types carry a base name here too so a label can be produced from the type alone
 * (e.g. {@link itemTypeLabel}, used where only the type is known). {@link formatItemLabel} formats the
 * data-bearing types from the item's own fields and falls back to this map for the toggles.
 */
export const ITEM_TYPE_LABELS: Record<string, string> = {
  // Agreement labels come from the canonical AGREEMENT_METADATA (single source of truth); the
  // data-bearing types keep their own labels here (they are not "agreements").
  ...Object.fromEntries(AGREEMENT_METADATA.map((a) => [a.itemType, a.label])),
  GOLD: "Gold",
  GOLD_PER_TURN: "Gold per turn",
  RESOURCES: "Resource",
  CITIES: "City",
  TECHS: "Technology",
  THIRD_PARTY_PEACE: "Third-party peace",
  THIRD_PARTY_WAR: "Third-party war",
  VOTE_COMMITMENT: "Vote commitment",
};

/** A friendly label from an item type alone (no per-item data), for the per-term inspection list. */
export function itemTypeLabel(itemType: string): string {
  return ITEM_TYPE_LABELS[itemType] ?? itemType;
}

/** Promise types that carry a third-party target (Coop War); the canonical derived set. */
const PROMISE_NEEDS_TARGET = TARGETED_PROMISE_TYPES;

/**
 * A short human label for a trade item. Unlike the web board there is no live tradable range on the
 * diplomat path, so resource/city/tech/team NAMES fall back to their IDs; amounts/quantities/votes
 * and the fixed duration come off the item itself. (e.g. "Allow Embassy", "Gold: 50", "Resource #7
 * ×2 (30t)", "City #4".)
 */
export function formatItemLabel(item: TradeItem): string {
  const dur = item.duration ? ` (${item.duration}t)` : "";
  switch (item.itemType) {
    case "GOLD":
      return `Gold: ${item.amount ?? 0}`;
    case "GOLD_PER_TURN":
      return `Gold/turn: ${item.amount ?? 0}${dur}`;
    case "RESOURCES":
      return `Resource #${item.resourceID} ×${item.quantity ?? 0}${dur}`;
    case "CITIES":
      return `City #${item.cityID}`;
    case "TECHS":
      return `Tech #${item.techID}`;
    case "THIRD_PARTY_PEACE":
      return `Peace with team ${item.thirdPartyTeamID}${dur}`;
    case "THIRD_PARTY_WAR":
      return `War with team ${item.thirdPartyTeamID}`;
    case "VOTE_COMMITMENT": {
      const votes = item.numVotes;
      const tail = votes !== undefined ? ` (${votes} ${votes === 1 ? "vote" : "votes"})` : "";
      return `Vote: resolution ${item.resolutionID}${tail}`;
    }
    default:
      return (ITEM_TYPE_LABELS[item.itemType] ?? item.itemType) + dur;
  }
}

/**
 * A promise term's display label. Three-party promises resolve their target's civ name from
 * `targetNames` when supplied, else fall back to the bare player ID.
 */
export function formatPromiseLabel(promise: PromiseTerm, targetNames?: Record<number, string>): string {
  const base = PROMISE_METADATA[promise.promiseType].label;
  if (PROMISE_NEEDS_TARGET.has(promise.promiseType) && promise.targetPlayerID !== undefined) {
    const name = targetNames?.[promise.targetPlayerID] ?? `player ${promise.targetPlayerID}`;
    return `${base} (target: ${name})`;
  }
  return base;
}

/** The two possible directions between the endpoints, ordered so the viewer's giving side comes first. */
function orderedDirections(
  viewerID: number,
  player1ID: number,
  player2ID: number
): Array<{ from: number; to: number }> {
  const dirs = [
    { from: player1ID, to: player2ID },
    { from: player2ID, to: player1ID },
  ];
  return dirs[0].from === viewerID ? dirs : [dirs[1], dirs[0]];
}

/** Render one directional section when it has rows. */
function formatDirectionBlock(
  from: number,
  to: number,
  verb: "gives" | "promises",
  rows: string[],
  civName: (playerID: number) => string
): string | undefined {
  if (rows.length === 0) return undefined;
  return [`# ${civName(from)} ${verb} ${civName(to)}`, ...rows].join("\n");
}

/**
 * Render a deal's terms grouped by direction, with civ names and the advisory per-item value
 * estimates framed "to <civ> (giving|receiving)". Pass `value1`/`value2` (the stored snapshots keyed
 * by item index, → player1ID / player2ID) to show values, or `undefined` to render terms only. The
 * single {@link ADVISORY_NOTE} is prepended once when any value clause is rendered. Returns "" for an
 * empty deal.
 */
export function formatDealTermsByDirection(
  deal: DealPayload,
  value1: PerItemValueMap | undefined,
  value2: PerItemValueMap | undefined,
  player1ID: number,
  player2ID: number,
  civName: (playerID: number) => string,
  viewerID: number
): string {
  const valueToSide = (index: number, sideID: number): number | undefined => {
    const map = sideID === player1ID ? value1 : sideID === player2ID ? value2 : undefined;
    return map?.[String(index)];
  };

  const directions = orderedDirections(viewerID, player1ID, player2ID);
  const blocks: string[] = [];
  let renderedAnyValue = false;

  // Trade-item sections (one per direction that has items).
  for (const { from, to } of directions) {
    const rows = deal.items.flatMap((item, index) => {
      if (item.fromPlayerID !== from || item.toPlayerID !== to) return [];
      const clauses = [
        formatSideValue(valueToSide(index, to), civName(to), "receive"),
        formatSideValue(valueToSide(index, from), civName(from), "give"),
      ].filter(Boolean);
      if (clauses.length > 0) renderedAnyValue = true;
      return [`- ${formatItemLabel(item)}${clauses.length ? `: ${clauses.join("; ")}` : ""}`];
    });
    const block = formatDirectionBlock(from, to, "gives", rows, civName);
    if (block) blocks.push(block);
  }

  // Promise sections (one per direction that has promises) — promises carry no value clause.
  for (const { from, to } of directions) {
    const rows = deal.promises
      .filter((p) => p.promiserID === from && p.recipientID === to)
      .map((promise) => `- ${formatPromiseLabel(promise)}`);
    const block = formatDirectionBlock(from, to, "promises", rows, civName);
    if (block) blocks.push(block);
  }

  if (blocks.length === 0) return "";
  return (renderedAnyValue ? [ADVISORY_NOTE, ...blocks] : blocks).join("\n\n");
}
