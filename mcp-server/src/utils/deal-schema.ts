/**
 * Pinned contracts for interactive-diplomacy deals (stage 3).
 *
 * This module is the single source of truth for the structured deal payload that
 * proposal/counter transcript messages store in `Payload.Deal`, the per-item value
 * snapshots stored in `Payload.Value1` / `Payload.Value2`, and the shape the
 * read-only `inspect-deal` tool accepts and returns. Stages 4 (deal screen),
 * 5 (negotiator) and 6 (enact-agent-deal) import these schemas so the contract
 * stays comparable across the feature.
 *
 * A deal carries two kinds of terms (specs.md §3):
 *  - ordinary **trade items** (`items`) — each belongs to one side and maps onto
 *    `CvDeal` / `CvTradedItem` and the per-item `lAdd*Trade` Lua constructors;
 *  - **promise commitments** (`promises`) — a Vox-Deorum-only addition applied
 *    directly at enactment (stage 6), never through the `TradeableItems` enum.
 *
 * Everything here is advisory for inspection — legality/value gate nothing on the
 * agent path (specs.md §4). Legality and live game state are always fetched fresh;
 * the transcript stores only the proposed terms and optional value snapshots.
 *
 * The pure-data vocabulary and rules (item/promise types, {@link PROMISE_METADATA},
 * {@link AGREEMENT_METADATA}, the duration tables/helpers, the derived offered/targeted/symmetric
 * sets) live in the zod-free {@link ./deal-metadata deal-metadata.ts} so the browser bundle can
 * import them without pulling in zod; they are re-exported here, so existing `from ".../deal-schema.js"`
 * imports keep working. Only the zod schemas and the payload-shaping helpers that need them live here.
 */

import * as z from "zod";
import {
  TRADE_ITEM_TYPES,
  PROMISE_TYPES,
  DURATION_KEY_BY_ITEM_TYPE,
  PROMISE_DURATION_KEY_BY_TYPE,
  durationForItemType,
  durationForPromiseType,
  SYMMETRIC_TRADE_ITEM_TYPES,
  SYMMETRIC_PROMISE_TYPES,
  type DealDurations,
} from "./deal-metadata.js";

// Re-export the entire zod-free vocabulary so every consumer can keep importing it from deal-schema.
export * from "./deal-metadata.js";

/**
 * One ordinary trade item. `fromPlayerID` gives the item to `toPlayerID`. Only the
 * fields relevant to `itemType` are read (see the per-type mapping in inspect-deal.lua):
 *  - GOLD: amount
 *  - GOLD_PER_TURN: amount, duration (auto-filled)
 *  - RESOURCES: resourceID, quantity, duration (auto-filled)
 *  - CITIES: cityID (resolved to plot X/Y in Lua)
 *  - THIRD_PARTY_PEACE: thirdPartyTeamID, duration (auto-filled)
 *  - THIRD_PARTY_WAR: thirdPartyTeamID
 *  - TECHS: techID
 *  - VOTE_COMMITMENT: resolutionID, voteChoice, numVotes, repeal?
 *  - OPEN_BORDERS / DEFENSIVE_PACT / RESEARCH_AGREEMENT / PEACE_TREATY /
 *    DECLARATION_OF_FRIENDSHIP: duration (auto-filled)
 *  - MAPS / ALLOW_EMBASSY / VASSALAGE / VASSALAGE_REVOKE: no extra data
 *
 * `duration` is NOT author-supplied: it is a fixed game constant (deal / peace / relationship
 * duration, by item type — see {@link durationForItemType}) that the server stamps onto every
 * duration-bearing item ({@link applyDealDurations}). Authors use {@link AuthoredTradeItemSchema},
 * which omits it; it is present here because the stored/inspected canonical term carries it.
 */
export const TradeItemSchema = z.object({
  fromPlayerID: z.number().int().describe("The side giving this item"),
  toPlayerID: z.number().int().describe("The side receiving this item"),
  itemType: z.enum(TRADE_ITEM_TYPES).describe("Trade item type"),
  amount: z.number().int().optional().describe("Gold or gold-per-turn amount"),
  duration: z.number().int().optional().describe("Duration in turns (auto-filled server-side from the game's fixed per-type duration; not author-set)"),
  resourceID: z.number().int().optional().describe("RESOURCES: the resource type ID"),
  quantity: z.number().int().optional().describe("RESOURCES: quantity per turn"),
  cityID: z.number().int().optional().describe("CITIES: the giver's city ID"),
  thirdPartyTeamID: z.number().int().optional().describe("THIRD_PARTY_PEACE/WAR: the third-party team ID"),
  techID: z.number().int().optional().describe("TECHS: the technology ID"),
  resolutionID: z.number().int().optional().describe("VOTE_COMMITMENT: the World Congress resolution ID"),
  voteChoice: z.number().int().optional().describe("VOTE_COMMITMENT: the vote choice"),
  numVotes: z.number().int().optional().describe("VOTE_COMMITMENT: number of votes"),
  repeal: z.boolean().optional().describe("VOTE_COMMITMENT: true to repeal rather than enact"),
});
export type TradeItem = z.infer<typeof TradeItemSchema>;

/**
 * The author-facing trade item — what the negotiator's `propose-deal` tool and the Web deal editor
 * may author. Identical to {@link TradeItemSchema} but WITHOUT `duration`: durations are fixed game
 * constants, never author-chosen, so they are stripped from proposable terms and stamped server-side
 * instead (see {@link applyDealDurations}). Assignable to {@link TradeItem} (duration optional there).
 *
 * The mutual agreements (see {@link SYMMETRIC_TRADE_ITEM_TYPES}) are auto-completed onto both sides
 * server-side ({@link symmetrizeDeal}), so an author may list one side and the deal becomes mutual.
 */
export const AuthoredTradeItemSchema = TradeItemSchema.omit({ duration: true });
export type AuthoredTradeItem = z.infer<typeof AuthoredTradeItemSchema>;

/**
 * One promise commitment. `promiserID` pledges the promise toward `recipientID`.
 * Coop War carries a third-party `targetPlayerID`.
 */
export const PromiseTermSchema = z.object({
  promiserID: z.number().int().describe("The side making the pledge"),
  recipientID: z.number().int().describe("The side the pledge is made toward"),
  promiseType: z.enum(PROMISE_TYPES).describe("Promise type"),
  targetPlayerID: z.number().int().optional().describe("Third party for Coop War"),
  duration: z.number().int().optional().describe("Optional duration in turns"),
});
export type PromiseTerm = z.infer<typeof PromiseTermSchema>;

/**
 * The pinned `Payload.Deal` shape (version 1). An empty deal (no items, no promises)
 * is valid and meaningful — `inspect-deal` returns the full tradable range for it.
 */
export const DealPayloadSchema = z.object({
  version: z.literal(1).describe("Deal payload schema version"),
  items: z.array(TradeItemSchema).default([]).describe("Ordinary trade terms"),
  promises: z.array(PromiseTermSchema).default([]).describe("Promise commitment terms"),
  rationale: z.string().optional().describe("Inward reasoning for the proposing diplomat — not game state; ignored by inspect-deal"),
  message: z.string().optional().describe("One-sentence outward line accompanying the deal — not game state; ignored by inspect-deal"),
});
export type DealPayload = z.infer<typeof DealPayloadSchema>;

/**
 * Stamp every item's read-only game duration so the canonical (stored / inspected) deal carries the
 * fixed game value, never an author-supplied or missing one. Authored durations are ignored (the Web
 * editor never renders an undefined "× N turns"; agents cannot propose one). Duration-bearing items
 * get their per-type game duration (keeping any pre-existing value only when the game durations are
 * unavailable, e.g. a mock); every other item has any stray duration removed. Returns a new deal; the
 * input is not mutated.
 */
export function applyDealDurations(deal: DealPayload, durations: DealDurations): DealPayload {
  return {
    ...deal,
    items: deal.items.map((item) =>
      // Prefer the fixed game duration; fall back to the standard deal duration, then any existing
      // value when the game durations are unavailable (mock / older DLL).
      stampOrStripDuration(
        item,
        DURATION_KEY_BY_ITEM_TYPE[item.itemType] !== undefined,
        durationForItemType(item.itemType, durations) ?? item.duration
      )
    ),
    // Promises stamp the same way, but with no `defaultDuration` fallback — a promise without its own
    // window binds indefinitely (durationForPromiseType returns undefined, so a stray value is stripped).
    promises: deal.promises.map((promise) =>
      stampOrStripDuration(
        promise,
        PROMISE_DURATION_KEY_BY_TYPE[promise.promiseType] !== undefined,
        durationForPromiseType(promise.promiseType, durations) ?? promise.duration
      )
    ),
  };
}

/**
 * Stamp `resolved` onto a duration-bearing entry, or strip any stray `duration` from one that carries
 * none — shared by the item and promise branches of {@link applyDealDurations}. Never writes a
 * `duration: undefined` key. Returns the input unchanged when there is nothing to do.
 */
function stampOrStripDuration<T extends { duration?: number }>(
  entry: T,
  hasDurationKey: boolean,
  resolved: number | undefined
): T {
  if (!hasDurationKey) {
    if (entry.duration === undefined) return entry;
    const rest = { ...entry };
    delete rest.duration;
    return rest;
  }
  return resolved === undefined ? entry : { ...entry, duration: resolved };
}

/**
 * Ensure every mutual agreement (see {@link SYMMETRIC_TRADE_ITEM_TYPES}) sits on BOTH sides: for any
 * such item present in one direction, append its opposite-direction twin (same `itemType`, with
 * `fromPlayerID`/`toPlayerID` swapped) when it is not already there. These types carry no
 * discriminator data beyond `duration` (which {@link applyDealDurations} stamps by type afterward),
 * so the twin is just the item with its giver/receiver swapped. Idempotent — an already-symmetric
 * deal is returned unchanged. Returns a new deal; the input is not mutated.
 */
export function symmetrizeDeal(deal: DealPayload): DealPayload {
  const items = [...deal.items];
  for (const item of deal.items) {
    if (!SYMMETRIC_TRADE_ITEM_TYPES.has(item.itemType)) continue;
    const hasTwin = items.some(
      (i) =>
        i.itemType === item.itemType &&
        i.fromPlayerID === item.toPlayerID &&
        i.toPlayerID === item.fromPlayerID
    );
    if (!hasTwin) {
      items.push({ ...item, fromPlayerID: item.toPlayerID, toPlayerID: item.fromPlayerID });
    }
  }

  // Mirror mutual promises (Coop War) the same way: a joint war binds both sides against the same
  // target, so complete the opposite-direction twin (same target) when it is missing.
  const promises = [...deal.promises];
  for (const promise of deal.promises) {
    if (!SYMMETRIC_PROMISE_TYPES.has(promise.promiseType)) continue;
    const hasTwin = promises.some(
      (p) =>
        p.promiseType === promise.promiseType &&
        p.promiserID === promise.recipientID &&
        p.recipientID === promise.promiserID &&
        p.targetPlayerID === promise.targetPlayerID
    );
    if (!hasTwin) {
      promises.push({ ...promise, promiserID: promise.recipientID, recipientID: promise.promiserID });
    }
  }

  const itemsChanged = items.length !== deal.items.length;
  const promisesChanged = promises.length !== deal.promises.length;
  if (!itemsChanged && !promisesChanged) return deal;
  return { ...deal, items, promises };
}

/**
 * Per-item value snapshot map for one ordered player, stored on proposal/counter
 * messages as `Payload.Value1` (→ Player1ID) / `Payload.Value2` (→ Player2ID).
 * Keyed by trade-item index (as a string) into `Payload.Deal.items`, holding the
 * proposal-time `GetTradeItemValue` of that item from that player's perspective.
 * Promises are excluded (their agreeability is factor-based, not a value). The
 * trade screen's other-side total balance is summed from these on the client —
 * `inspect-deal` returns per-item values only, never a precomputed total.
 */
export const PerItemValueMapSchema = z.record(z.string(), z.number());
export type PerItemValueMap = z.infer<typeof PerItemValueMapSchema>;
