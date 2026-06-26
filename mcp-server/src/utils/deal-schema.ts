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
 * The nine diplomatic promises that exist on the agent path (specs.md §3, Promises as deal terms) —
 * the full DLL contract, kept intact so inspecting/displaying any pre-existing term never breaks.
 * Which of these are actually OFFERED to authors (negotiator + Web editor), which need a third-party
 * target, which the game treats as mutual, and how long each binds are described once in
 * {@link PROMISE_METADATA} — the single source of truth all surfaces derive from. Enacted in stage 6.
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
  "COOP_WAR", // prepared joint war against targetPlayerID — begins after the preparation countdown
              // (COOP_WAR_SOON_COUNTER turns); mutual/symmetric (see symmetrizeDeal). An immediate,
              // one-sided war is the directed THIRD_PARTY_WAR trade item instead.
] as const;

export type PromiseType = (typeof PROMISE_TYPES)[number];

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
 * The three game-speed durations `inspect-deal` reports (Game.Get{Deal,Peace,Relationship}Duration).
 * Each is optional so a mock — or a DLL without the accessor — degrades gracefully (no stamping).
 */
export interface DealDurations {
  defaultDuration?: number;
  peaceDuration?: number;
  relationshipDuration?: number;
  /** Military promise ("won't attack") binding window in turns (flat; `Game.GetMilitaryPromiseDuration`). */
  militaryPromiseDuration?: number;
  /** Expansion promise ("won't settle near") binding window in turns (`Game.GetExpansionPromiseDuration`). */
  expansionPromiseDuration?: number;
  /** Border promise ("won't buy plots") binding window in turns (`Game.GetBorderPromiseDuration`). */
  borderPromiseDuration?: number;
  /** Coop War preparation countdown in turns before the war auto-declares (`COOP_WAR_SOON_COUNTER`). */
  coopWarPromiseDuration?: number;
}

/**
 * Per-promise metadata — the single source of truth for the promise rules that must stay consistent
 * across every surface (the negotiator's Give/Take ledger, the human Web deal editor, the server-side
 * renderers, and the backend authoring guard). Deriving each surface from this table means the
 * "offered set", targeting, mutuality, and binding duration can never drift between them.
 *
 *  - `offered`   — does the tactical AI behaviorally honor this promise? Only honored promises are
 *                  authorable; the rest stay in {@link PROMISE_TYPES} (so inspecting/displaying a
 *                  pre-existing term still works) but are filtered out of every authoring surface and
 *                  rejected at the writer ({@link isOfferedPromiseType}). Criterion established by DLL
 *                  investigation: MILITARY/EXPANSION/BORDER/NO_DIGGING/COOP_WAR are read by the AI's
 *                  own decision logic; SPY is detection-only, and NO_CONVERT/BULLY_CITY_STATE/
 *                  ATTACK_CITY_STATE are reputation-only (the city-state enforcement is commented out
 *                  in the DLL). Re-enable by flipping `offered` if the DLL ever enforces them.
 *  - `targeted`  — requires a third-party `targetPlayerID` (Coop War major; the city-state promises).
 *  - `symmetric` — the game treats it as mutual (both sides pledge), so {@link symmetrizeDeal} mirrors it.
 *  - `durationKey` — which {@link DealDurations} field carries its binding window; omitted ⇒ binds
 *                  indefinitely (no fixed term).
 *  - `label`     — the single human label, in the promiser's voice, used everywhere: the negotiator's
 *                  authorable Give/Take ledger (it IS the propose-deal enum value), the human Web
 *                  editor, and the server-side renderers. One label, so the surfaces never splinter.
 */
export interface PromiseMeta {
  label: string;
  offered: boolean;
  targeted: boolean;
  symmetric: boolean;
  durationKey?: keyof DealDurations;
}

export const PROMISE_METADATA: Record<PromiseType, PromiseMeta> = {
  MILITARY:          { label: "Won't attack / will move troops away",   offered: true,  targeted: false, symmetric: false, durationKey: "militaryPromiseDuration" },
  EXPANSION:         { label: "Won't settle near you",                  offered: true,  targeted: false, symmetric: false, durationKey: "expansionPromiseDuration" },
  BORDER:            { label: "Won't buy plots near your cities",       offered: true,  targeted: false, symmetric: false, durationKey: "borderPromiseDuration" },
  NO_CONVERT:        { label: "Won't spread my religion to you",        offered: false, targeted: false, symmetric: false },
  NO_DIGGING:        { label: "Won't dig your antiquity sites",         offered: true,  targeted: false, symmetric: false },
  SPY:               { label: "Won't spy on you",                       offered: false, targeted: false, symmetric: false },
  BULLY_CITY_STATE:  { label: "Won't bully your protected city-state",  offered: false, targeted: true,  symmetric: false },
  ATTACK_CITY_STATE: { label: "Won't attack your protected city-state", offered: false, targeted: true,  symmetric: false },
  COOP_WAR:          { label: "Will join a cooperative war",            offered: true,  targeted: true,  symmetric: true,  durationKey: "coopWarPromiseDuration" },
};

/** The promise types actually offered to authors (the tactical AI honors them); derived from metadata. */
export const OFFERED_PROMISE_TYPES: ReadonlySet<PromiseType> = new Set(
  PROMISE_TYPES.filter((t) => PROMISE_METADATA[t].offered)
);

/** Whether a promise type may be authored (offered) on the agent / Web editor surfaces. */
export function isOfferedPromiseType(promiseType: string): boolean {
  return (PROMISE_METADATA as Record<string, PromiseMeta | undefined>)[promiseType]?.offered ?? false;
}

/** Promise types that require a third-party `targetPlayerID` (Coop War + the city-state promises). */
export const TARGETED_PROMISE_TYPES: ReadonlySet<PromiseType> = new Set(
  PROMISE_TYPES.filter((t) => PROMISE_METADATA[t].targeted)
);

/**
 * Which fixed game duration each trade-item type runs for. Types absent here carry no duration (gold
 * lump, cities, techs, third-party war, votes, maps, embassy, vassalage). Durations are read-only game
 * constants, never author-set — mirrored by `durationFor` in inspect-deal.lua and deal-catalog.ts.
 */
const DURATION_KEY_BY_ITEM_TYPE: Partial<Record<TradeItem["itemType"], keyof DealDurations>> = {
  GOLD_PER_TURN: "defaultDuration",
  RESOURCES: "defaultDuration",
  OPEN_BORDERS: "defaultDuration",
  DEFENSIVE_PACT: "defaultDuration",
  RESEARCH_AGREEMENT: "defaultDuration",
  PEACE_TREATY: "peaceDuration",
  THIRD_PARTY_PEACE: "peaceDuration",
  DECLARATION_OF_FRIENDSHIP: "relationshipDuration",
};

/**
 * The fixed, game-set duration for an item type, or `undefined` when it carries none (or the game
 * durations are unavailable). Peace / relationship fall back to the standard deal duration.
 */
export function durationForItemType(itemType: TradeItem["itemType"], durations: DealDurations): number | undefined {
  const key = DURATION_KEY_BY_ITEM_TYPE[itemType];
  return key ? durations[key] ?? durations.defaultDuration : undefined;
}

/**
 * Which game duration each promise type runs for, derived from {@link PROMISE_METADATA}. Only the
 * promises that carry a binding window appear (the three standing promises have their own, and Coop
 * War carries its preparation countdown); the rest bind indefinitely. Mirrors
 * {@link DURATION_KEY_BY_ITEM_TYPE} for promises.
 */
const PROMISE_DURATION_KEY_BY_TYPE: Partial<Record<PromiseTerm["promiseType"], keyof DealDurations>> =
  Object.fromEntries(
    PROMISE_TYPES.flatMap((t) => {
      const key = PROMISE_METADATA[t].durationKey;
      return key ? [[t, key] as const] : [];
    })
  );

/**
 * The fixed, game-set duration for a promise type, or `undefined` when it carries none (binds
 * indefinitely) or the game durations are unavailable. Unlike {@link durationForItemType} there is no
 * fallback to the standard deal duration — a promise without its own window genuinely has none.
 */
export function durationForPromiseType(
  promiseType: PromiseTerm["promiseType"],
  durations: DealDurations
): number | undefined {
  const key = PROMISE_DURATION_KEY_BY_TYPE[promiseType];
  return key ? durations[key] : undefined;
}

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
 * The single source of truth for the "Agreements" trade items — the single-shot toggles and the four
 * mutual pacts the deal editor groups together — listed in the in-game category order. Each row
 * carries:
 *  - `label`    — the one display label used everywhere (negotiator menu, Web editor, server renderers);
 *  - `rangeKey` — the name of this item's `CandidateLegality` slot on the inspect-deal
 *                 `NormalizedSideRange` (typed `string` to keep this base contract free of the tool's
 *                 range shape — consumers cast it back to `keyof NormalizedSideRange`);
 *  - `mutual`   — the game binds BOTH sides (a DoF / pact / peace always pairs), so
 *                 {@link symmetrizeDeal} completes the missing side and the Web editor mirrors on
 *                 add/remove. {@link SYMMETRIC_TRADE_ITEM_TYPES} is derived from this flag.
 *
 * The negotiator menu, the Web editor toggle list, and the server label map all derive from this, so
 * the label / order / mutuality never splinter between surfaces.
 */
export interface AgreementMeta {
  itemType: TradeItem["itemType"];
  label: string;
  rangeKey: string;
  mutual: boolean;
}

export const AGREEMENT_METADATA: readonly AgreementMeta[] = [
  { itemType: "ALLOW_EMBASSY",             label: "Allow Embassy",             rangeKey: "allowEmbassy",            mutual: false },
  { itemType: "OPEN_BORDERS",              label: "Open Borders",              rangeKey: "openBorders",             mutual: false },
  { itemType: "DEFENSIVE_PACT",            label: "Defensive Pact",            rangeKey: "defensivePact",           mutual: true },
  { itemType: "RESEARCH_AGREEMENT",        label: "Research Agreement",        rangeKey: "researchAgreement",       mutual: true },
  { itemType: "DECLARATION_OF_FRIENDSHIP", label: "Declaration of Friendship", rangeKey: "declarationOfFriendship", mutual: true },
  { itemType: "MAPS",                      label: "Maps",                      rangeKey: "maps",                    mutual: false },
  { itemType: "PEACE_TREATY",              label: "Peace Treaty",              rangeKey: "peaceTreaty",             mutual: true },
  { itemType: "VASSALAGE",                 label: "Vassalage",                 rangeKey: "vassalage",               mutual: false },
  { itemType: "VASSALAGE_REVOKE",          label: "Revoke Vassalage",          rangeKey: "vassalageRevoke",         mutual: false },
];

/**
 * Trade items the game treats as **mutual** — derived from {@link AGREEMENT_METADATA}. A Declaration
 * of Friendship, Defensive Pact, Research Agreement, or Peace Treaty always binds BOTH sides, so the
 * in-game trade screen pairs them automatically. Our model stores them as ordinary directed items, so
 * a one-sided pact is possible to author but the game then reports it untradeable; {@link symmetrizeDeal}
 * completes the missing side before inspection/storage and the Web editor mirrors on add/remove.
 */
export const SYMMETRIC_TRADE_ITEM_TYPES: ReadonlySet<TradeItem["itemType"]> = new Set(
  AGREEMENT_METADATA.filter((a) => a.mutual).map((a) => a.itemType)
);

/**
 * Promise types the game treats as **mutual**: a Cooperative War is a joint commitment — both sides
 * pledge to attack the same target — so {@link symmetrizeDeal} completes the missing side, letting an
 * author list it once. (A one-sided, immediate war is the directed `THIRD_PARTY_WAR` trade item.)
 * Derived from {@link PROMISE_METADATA}.
 */
export const SYMMETRIC_PROMISE_TYPES: ReadonlySet<PromiseTerm["promiseType"]> = new Set(
  PROMISE_TYPES.filter((t) => PROMISE_METADATA[t].symmetric)
);

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
