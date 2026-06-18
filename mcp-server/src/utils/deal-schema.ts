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
 */

import * as z from "zod";

/**
 * The trade-item types `inspect-deal` understands, mirroring the game's
 * `TradeableItems` enum (sans the deprecated entries). String-typed so the deal
 * payload is human-readable and stable across DLL enum reordering; the Lua layer
 * maps each back to `TradeableItems.TRADE_ITEM_*`.
 */
export const TRADE_ITEM_TYPES = [
  "GOLD",
  "GOLD_PER_TURN",
  "MAPS",
  "RESOURCES",
  "CITIES",
  "OPEN_BORDERS",
  "DEFENSIVE_PACT",
  "RESEARCH_AGREEMENT",
  "PEACE_TREATY",
  "THIRD_PARTY_PEACE",
  "THIRD_PARTY_WAR",
  "ALLOW_EMBASSY",
  "DECLARATION_OF_FRIENDSHIP",
  "VOTE_COMMITMENT",
  "TECHS",
  "VASSALAGE",
  "VASSALAGE_REVOKE",
] as const;

/**
 * The nine diplomatic promises tradeable on the agent path (specs.md §3, Promises
 * as deal terms). Eight standing promises plus the structurally-different Coop War.
 * Enacted in stage 6; here they only carry agreeability factors.
 */
export const PROMISE_TYPES = [
  "MILITARY", // "won't attack / move troops away"
  "EXPANSION", // "don't settle near me"
  "BORDER", // "don't buy plots near my cities"
  "NO_CONVERT", // "don't spread religion"
  "NO_DIGGING", // "don't dig my antiquity sites"
  "SPY", // "stop spying on me"
  "BULLY_CITY_STATE", // "stop bullying my protected city-state"
  "ATTACK_CITY_STATE", // "don't attack my protected city-state"
  "COOP_WAR", // "join/honor a cooperative war" (needs targetPlayerID)
] as const;

/**
 * One ordinary trade item. `fromPlayerID` gives the item to `toPlayerID`. Only the
 * fields relevant to `itemType` are read (see the per-type mapping in inspect-deal.lua):
 *  - GOLD: amount
 *  - GOLD_PER_TURN: amount, duration?
 *  - RESOURCES: resourceID, quantity, duration?
 *  - CITIES: cityID (resolved to plot X/Y in Lua)
 *  - THIRD_PARTY_PEACE: thirdPartyTeamID, duration?
 *  - THIRD_PARTY_WAR: thirdPartyTeamID
 *  - TECHS: techID
 *  - VOTE_COMMITMENT: resolutionID, voteChoice, numVotes, repeal?
 *  - OPEN_BORDERS / DEFENSIVE_PACT / RESEARCH_AGREEMENT / PEACE_TREATY / MAPS /
 *    ALLOW_EMBASSY / DECLARATION_OF_FRIENDSHIP: duration? (defaults to the game's deal duration)
 *  - VASSALAGE / VASSALAGE_REVOKE: no extra data
 */
export const TradeItemSchema = z.object({
  fromPlayerID: z.number().int().describe("The side giving this item"),
  toPlayerID: z.number().int().describe("The side receiving this item"),
  itemType: z.enum(TRADE_ITEM_TYPES).describe("Trade item type"),
  amount: z.number().int().optional().describe("Gold or gold-per-turn amount"),
  duration: z.number().int().optional().describe("Duration in turns (defaults to the game's deal duration)"),
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
 * One promise commitment. `promiserID` pledges the promise toward `recipientID`.
 * Coop War (and city-state-related promises) carry a `targetPlayerID`.
 */
export const PromiseTermSchema = z.object({
  promiserID: z.number().int().describe("The side making the pledge"),
  recipientID: z.number().int().describe("The side the pledge is made toward"),
  promiseType: z.enum(PROMISE_TYPES).describe("Promise type"),
  targetPlayerID: z.number().int().optional().describe("Third party for Coop War / city-state-related promises"),
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
