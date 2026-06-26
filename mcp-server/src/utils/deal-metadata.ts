/**
 * Zod-free deal vocabulary and rules (trade items, promises, agreements; targeting, mutuality,
 * durations). Split out of `deal-schema.ts` so the browser bundle can import the canonical tables
 * without pulling in zod. `deal-schema.ts` re-exports all of it, so server imports are unchanged;
 * the zod schemas and the helpers needing `DealPayload` stay there.
 */

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

/** The trade-item type union — identical to `TradeItem["itemType"]` (the zod-inferred type). */
export type TradeItemType = (typeof TRADE_ITEM_TYPES)[number];

/**
 * The authorable promises (specs.md §3) — only the ones the tactical AI behaviorally honors; their
 * rules live in {@link PROMISE_METADATA}. The other four DLL promises are commented out (the AI does
 * not honor them — SPY is detection-only, the rest reputation-only with city-state enforcement
 * disabled in the DLL — and Lua no longer reports them). Kept as comments so the full contract stays
 * documented; uncomment here and in {@link PROMISE_METADATA} if the DLL ever enforces them.
 */
export const PROMISE_TYPES = [
  "MILITARY", // "won't attack / move troops away"
  "EXPANSION", // "don't settle near me"
  "BORDER", // "don't buy plots near my cities"
  // "NO_CONVERT", // "don't spread religion" — reputation-only; not honored by the AI
  "NO_DIGGING", // "don't dig my antiquity sites"
  // "SPY", // "stop spying on me" — detection-only; not honored by the AI
  // "BULLY_CITY_STATE", // "stop bullying my protected city-state" — enforcement commented out in DLL
  // "ATTACK_CITY_STATE", // "don't attack my protected city-state" — enforcement commented out in DLL
  "COOP_WAR", // prepared joint war against targetPlayerID — begins after the preparation countdown
              // (COOP_WAR_SOON_COUNTER turns); mutual/symmetric (see symmetrizeDeal). An immediate,
              // one-sided war is the directed THIRD_PARTY_WAR trade item instead.
] as const;

export type PromiseType = (typeof PROMISE_TYPES)[number];

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
 * Per-promise rules — the single source of truth every surface (negotiator ledger, Web editor, server
 * renderers) derives from, so labels/targeting/mutuality/duration never splinter. Only authorable
 * promises are listed (a promise is in the contract or it is not — no "offered" flag).
 */
export interface PromiseMeta {
  /** The one human label, promiser's voice — also the propose-deal enum value. */
  label: string;
  /** Requires a third-party `targetPlayerID` (Coop War). */
  targeted: boolean;
  /** Mutual (both sides pledge), so `symmetrizeDeal` mirrors it. */
  symmetric: boolean;
  /** Which {@link DealDurations} field is its binding window; omitted ⇒ binds indefinitely. */
  durationKey?: keyof DealDurations;
}

export const PROMISE_METADATA: Record<PromiseType, PromiseMeta> = {
  MILITARY:  { label: "Won't attack / will move troops away", targeted: false, symmetric: false, durationKey: "militaryPromiseDuration" },
  EXPANSION: { label: "Won't settle near you",                targeted: false, symmetric: false, durationKey: "expansionPromiseDuration" },
  BORDER:    { label: "Won't buy plots near your cities",     targeted: false, symmetric: false, durationKey: "borderPromiseDuration" },
  NO_DIGGING:{ label: "Won't dig your antiquity sites",       targeted: false, symmetric: false },
  COOP_WAR:  { label: "Will join a cooperative war",          targeted: true,  symmetric: true,  durationKey: "coopWarPromiseDuration" },
};

/** Promise types that require a third-party `targetPlayerID` (Coop War). Derived from the metadata. */
export const TARGETED_PROMISE_TYPES: ReadonlySet<PromiseType> = new Set(
  PROMISE_TYPES.filter((t) => PROMISE_METADATA[t].targeted)
);

/**
 * Which fixed game duration each trade-item type runs for. Types absent here carry no duration (gold
 * lump, cities, techs, third-party war, votes, maps, embassy, vassalage). Durations are read-only game
 * constants, never author-set — mirrored by `durationFor` in inspect-deal.lua.
 */
export const DURATION_KEY_BY_ITEM_TYPE: Partial<Record<TradeItemType, keyof DealDurations>> = {
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
export function durationForItemType(itemType: TradeItemType, durations: DealDurations): number | undefined {
  const key = DURATION_KEY_BY_ITEM_TYPE[itemType];
  return key ? durations[key] ?? durations.defaultDuration : undefined;
}

/**
 * Which game duration each promise type runs for, derived from {@link PROMISE_METADATA}. Only the
 * promises that carry a binding window appear (the three standing promises have their own, and Coop
 * War carries its preparation countdown); the rest bind indefinitely. Mirrors
 * {@link DURATION_KEY_BY_ITEM_TYPE} for promises.
 */
export const PROMISE_DURATION_KEY_BY_TYPE: Partial<Record<PromiseType, keyof DealDurations>> =
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
  promiseType: PromiseType,
  durations: DealDurations
): number | undefined {
  const key = PROMISE_DURATION_KEY_BY_TYPE[promiseType];
  return key ? durations[key] : undefined;
}

/**
 * Single source of truth for the "Agreements" trade items (single-shot toggles + the four mutual
 * pacts), in in-game category order. The negotiator menu, Web editor toggles, and server label map all
 * derive from this, so label/order/mutuality never splinter.
 */
export interface AgreementMeta {
  itemType: TradeItemType;
  /** The one display label used everywhere. */
  label: string;
  /** This item's `CandidateLegality` slot on the inspect-deal `NormalizedSideRange`; typed `string`
   *  to keep this base contract free of the tool's range shape (consumers cast to `keyof ...`). */
  rangeKey: string;
  /** Game binds BOTH sides; `symmetrizeDeal` completes the missing side. Drives {@link SYMMETRIC_TRADE_ITEM_TYPES}. */
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
 * a one-sided pact is possible to author but the game then reports it untradeable; `symmetrizeDeal`
 * completes the missing side before inspection/storage and the Web editor mirrors on add/remove.
 */
export const SYMMETRIC_TRADE_ITEM_TYPES: ReadonlySet<TradeItemType> = new Set(
  AGREEMENT_METADATA.filter((a) => a.mutual).map((a) => a.itemType)
);

/**
 * Promise types the game treats as **mutual**: a Cooperative War is a joint commitment — both sides
 * pledge to attack the same target — so `symmetrizeDeal` completes the missing side, letting an
 * author list it once. (A one-sided, immediate war is the directed `THIRD_PARTY_WAR` trade item.)
 * Derived from {@link PROMISE_METADATA}.
 */
export const SYMMETRIC_PROMISE_TYPES: ReadonlySet<PromiseType> = new Set(
  PROMISE_TYPES.filter((t) => PROMISE_METADATA[t].symmetric)
);
