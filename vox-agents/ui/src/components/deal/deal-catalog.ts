/**
 * Pure inventory-catalog helpers for the three-panel deal board (interactive-diplomacy stage 4).
 *
 * Turns one side's `NormalizedSideRange` (+ fixed game durations, current deal) into the ordered,
 * categorized inventory model the in-game trade screen presents, and provides the selected-state
 * and offer→deal-index mapping the board needs. No Vue/DOM imports, so the grouping/ordering is
 * unit-tested directly.
 *
 * Interaction model (settled with the user): clicking an inventory row adds the term immediately
 * with sensible defaults; amounts / quantities / targets are edited on the central offer rows,
 * while game-set durations are displayed read-only. Singleton terms already on the table show
 * selected + disabled.
 */

import type { TradeItem, PromiseTerm, NormalizedSideRange, CandidateLegality, PromiseTargetInfo } from '@/utils/types';
import {
  PROMISE_TYPES,
  PROMISE_LABELS,
  PROMISE_NEEDS_TARGET,
  TOGGLE_ITEMS,
  sideGives,
} from './deal-helpers';

/** The inventory categories, in the in-game display order. */
export type CategoryKind =
  | 'gold'
  | 'luxury'
  | 'strategic'
  | 'congress'
  | 'toggles'
  | 'cities'
  | 'techs'
  | 'thirdParty'
  | 'promises';

/** What a clicked inventory row appends to the working deal (defaults pre-filled). */
export type AddTermPayload =
  | { kind: 'item'; item: TradeItem }
  | { kind: 'promise'; promise: PromiseTerm };

/**
 * One eligible target for an expandable row (a third-party team, a Coop War major, or a
 * city-state). Self-contained: it carries the exact, already-targeted term to add, so the
 * inventory panel just emits `addPayload` on click. The same shape serves promises and
 * third-party trade items.
 */
export interface InventoryTarget {
  /** Stable key for v-for. */
  key: string;
  /** Target display name (civ / city-state / team), or a numeric fallback. */
  label: string;
  /** Structural / eligibility legality; false → disabled (e.g. Coop War not eligible). */
  legal: boolean;
  /** Reason lines shown as a tooltip when ineligible. */
  reasons: string[];
  /** Already on the table for this side → shown selected + disabled. */
  selected: boolean;
  /** The fully-targeted term this choice adds. */
  addPayload: AddTermPayload;
}

/** One inventory row: either a direct-add row (`addPayload`) or an expandable target row (`targets`). */
export interface InventoryRow {
  /** Stable key for v-for and tests. */
  key: string;
  /** Game-facing label (resource/tech/city/promise name, or "Make peace with…", or a fallback). */
  label: string;
  /** Optional secondary hint (quantity available, target count, …). */
  secondary?: string;
  /** Structural legality; false → red + not addable. (Always true for expandable header rows.) */
  legal: boolean;
  /** Reason lines shown as a tooltip when illegal (empty when legal). */
  reasons: string[];
  /** A singleton already on the table → shown selected + disabled. (Always false for expandable rows.) */
  selected: boolean;
  /** What to emit on click — present for direct-add rows, absent for expandable rows. */
  addPayload?: AddTermPayload;
  /** Eligible targets — present for expandable rows (targeted promises, third-party peace/war). */
  targets?: InventoryTarget[];
}

/** One inventory category with its ordered rows. */
export interface InventoryCategory {
  kind: CategoryKind;
  title: string;
  rows: InventoryRow[];
}

/** One side in the central/read-only offer columns. */
export interface OfferSide {
  sideID: number;
  label: string;
}

/** One giver column, preserving each term's original deal index. */
export interface OfferColumn {
  sideID: number;
  label: string;
  items: Array<{ item: TradeItem; index: number }>;
  promises: Array<{ promise: PromiseTerm; index: number }>;
}

/** Discriminator data a default term may need (the row already knows which it is). */
export interface DefaultItemCtx {
  /** The fixed, game-set durations reported by inspect-deal; resolved here by item type. */
  durations?: DealDurations;
  resourceID?: number;
  cityID?: number;
  techID?: number;
  thirdPartyTeamID?: number;
  /** Seed gold amount (already capped by the caller against the range max). */
  gold?: number;
}

/** A sensible starting gold amount, capped at what the side can actually offer. */
const GOLD_SEED = 100;

/** The three game-speed durations `inspect-deal` reports, used to seed each term's fixed duration. */
export interface DealDurations {
  defaultDuration: number | undefined;
  peaceDuration: number | undefined;
  relationshipDuration: number | undefined;
}

/**
 * Which fixed game duration each trade-item type runs for; types absent carry none. Durations are
 * read-only game constants. Mirrors `durationForItemType` (server) and `durationFor` in
 * inspect-deal.lua (game side); duplicated here so the browser bundle needn't import the server module.
 */
const DURATION_KEY_BY_ITEM_TYPE: Partial<Record<TradeItem['itemType'], keyof DealDurations>> = {
  GOLD_PER_TURN: 'defaultDuration',
  RESOURCES: 'defaultDuration',
  OPEN_BORDERS: 'defaultDuration',
  DEFENSIVE_PACT: 'defaultDuration',
  RESEARCH_AGREEMENT: 'defaultDuration',
  PEACE_TREATY: 'peaceDuration',
  THIRD_PARTY_PEACE: 'peaceDuration',
  DECLARATION_OF_FRIENDSHIP: 'relationshipDuration',
};

/** The fixed, game-set duration for an item type (read-only), or `undefined` for the no-duration
 *  types. Peace / relationship fall back to the deal duration when their game-speed value is absent. */
export function durationFor(itemType: TradeItem['itemType'], durations: DealDurations): number | undefined {
  const key = DURATION_KEY_BY_ITEM_TYPE[itemType];
  return key ? durations[key] ?? durations.defaultDuration : undefined;
}

/** Adds a duration only when inspect-deal provided one for this fixed-duration item type. */
function withDuration(
  item: TradeItem,
  itemType: TradeItem['itemType'],
  durations: DealDurations | undefined
): TradeItem {
  const duration = durations ? durationFor(itemType, durations) : undefined;
  return duration === undefined ? item : { ...item, duration };
}

/**
 * Build a default trade item for an inventory row. Seeds quantity 1 and the game's default
 * duration for duration-bearing types when available; gold uses the (already capped) seed
 * amount. Amounts, quantities, and targets are editable afterwards on the central offer row.
 */
export function defaultItemFor(
  itemType: TradeItem['itemType'],
  ownerID: number,
  otherID: number,
  ctx: DefaultItemCtx = {}
): TradeItem {
  const base: TradeItem = { fromPlayerID: ownerID, toPlayerID: otherID, itemType };
  switch (itemType) {
    case 'GOLD':
      return { ...base, amount: ctx.gold ?? 0 };
    case 'GOLD_PER_TURN':
      // Seed 1 GPT (the minimum the game allows — VP-EUI uses "1 GPT … minimum possible"); 0 is not settable.
      return withDuration({ ...base, amount: 1 }, itemType, ctx.durations);
    case 'RESOURCES':
      return withDuration({ ...base, resourceID: ctx.resourceID, quantity: 1 }, itemType, ctx.durations);
    case 'CITIES':
      return { ...base, cityID: ctx.cityID };
    case 'TECHS':
      return { ...base, techID: ctx.techID };
    case 'THIRD_PARTY_PEACE':
      return withDuration({ ...base, thirdPartyTeamID: ctx.thirdPartyTeamID }, itemType, ctx.durations);
    case 'THIRD_PARTY_WAR':
      return { ...base, thirdPartyTeamID: ctx.thirdPartyTeamID };
    case 'VOTE_COMMITMENT':
      return { ...base, resolutionID: 0, voteChoice: 0, numVotes: 1, repeal: false };
    case 'OPEN_BORDERS':
    case 'DEFENSIVE_PACT':
    case 'RESEARCH_AGREEMENT':
    case 'PEACE_TREATY':
    case 'DECLARATION_OF_FRIENDSHIP':
      // Fixed-duration agreements: carry the game's per-type duration (the caller resolves the right
      // one via `withDuration`) so the row shows it and inspect/propose use it. DoF's value is the
      // relationship duration the game enforces internally — surfaced here for display.
      return withDuration(base, itemType, ctx.durations);
    default:
      // Single-shot toggles with no duration (embassy, maps, vassalage).
      return base;
  }
}

/** True when a no-discriminator singleton (toggle / gold) from `ownerID` is already on the table. */
export function isSingletonSelected(
  itemType: TradeItem['itemType'],
  ownerID: number,
  currentItems: TradeItem[]
): boolean {
  return currentItems.some((i) => i.fromPlayerID === ownerID && i.itemType === itemType);
}

/**
 * Offer rows for one giver, each paired with its index in `workingDeal.items`. That index is
 * also the index into the index-aligned `inspect-deal` `items[]`, so the central row's legality
 * and value line read straight from `inspectedItems[index]`. Thin wrapper over `sideGives` kept
 * here so the offer→deal mapping lives (and is tested) in one place.
 */
export function offerItemsForSide(items: TradeItem[], sideID: number): Array<{ item: TradeItem; index: number }> {
  return sideGives(items, sideID);
}

/** Promise terms one side promises (the side is the promiser), paired with their deal index. */
export function offerPromisesForSide(
  promises: PromiseTerm[],
  sideID: number
): Array<{ promise: PromiseTerm; index: number }> {
  return promises
    .map((promise, index) => ({ promise, index }))
    .filter(({ promise }) => promise.promiserID === sideID);
}

/** Build giver columns for a deal offer, sharing the side partitioning across renderers. */
export function offerColumnsFor(
  items: TradeItem[],
  promises: PromiseTerm[],
  sides: OfferSide[]
): OfferColumn[] {
  return sides.map(({ sideID, label }) => ({
    sideID,
    label,
    items: offerItemsForSide(items, sideID),
    promises: offerPromisesForSide(promises, sideID),
  }));
}

/**
 * Eligible targets for one targeted promise type, from the inspect-deal promise-target metadata.
 * Coop War lists major targets (ineligible only when `coopWarEligible === false` — absent ⇒ unknown
 * ⇒ shown); city-state promises list minor targets the recipient (`otherID`) protects. Each option
 * carries the fully-targeted promise to add and its `(type,target)` selected-state.
 */
export function promiseTargetsFor(
  promiseType: PromiseTerm['promiseType'],
  ownerID: number,
  otherID: number,
  promiseTargets: PromiseTargetInfo[],
  currentPromises: PromiseTerm[]
): InventoryTarget[] {
  const isCoopWar = promiseType === 'COOP_WAR';
  const eligible = promiseTargets.filter((t) =>
    isCoopWar
      ? t.kind === 'major'
      // City-state target: the recipient (`otherID`) must protect it. The bridge OMITS
      // `protectingPlayerIDs` when neither principal protects the minor (an empty array is
      // elided over the Lua/JSON boundary), so absence ⇒ ineligible — require presence + membership.
      : t.kind === 'minor' && !!t.protectingPlayerIDs?.includes(otherID)
  );
  return eligible.map((t) => ({
    key: `${promiseType}:${t.playerID}`,
    label: t.name ?? `player ${t.playerID}`,
    // Coop War: a definite `false` disables it; absent (older DLL) ⇒ shown. Others: always eligible.
    legal: isCoopWar ? t.coopWarEligible !== false : true,
    reasons: isCoopWar && t.coopWarEligible === false ? ['Not a valid cooperative-war target right now.'] : [],
    selected: currentPromises.some(
      (p) => p.promiserID === ownerID && p.promiseType === promiseType && p.targetPlayerID === t.playerID
    ),
    addPayload: { kind: 'promise', promise: { promiserID: ownerID, recipientID: otherID, promiseType, targetPlayerID: t.playerID } },
  }));
}

/**
 * Build the ordered, categorized inventory for one side. `ownerID` gives, `otherID` receives.
 * `currentItems` / `currentPromises` drive singleton selected-state. `defaultDuration` seeds
 * duration-bearing items; `peaceDuration` seeds peace / third-party-peace items (the game runs those
 * for the separate game-speed peace-deal duration, not the standard deal duration). World Congress
 * expands into the in-session resolutions the range
 * enumerates (each choice pre-filled, edited nowhere); promises surface all nine (target chosen
 * centrally).
 *
 * Always returns the full set of categories in order — empty ones included — so the panel decides
 * whether to render an empty category, and ordering is asserted directly in tests.
 */
export function buildSideCatalog(args: {
  ownerID: number;
  otherID: number;
  range: NormalizedSideRange | undefined;
  currentItems: TradeItem[];
  currentPromises: PromiseTerm[];
  defaultDuration: number | undefined;
  /** Game-speed peace-deal duration; seeds peace / third-party-peace items. Falls back to `defaultDuration`. */
  peaceDuration: number | undefined;
  /** Game-speed relationship duration; seeds the Declaration of Friendship's fixed duration. Falls back to `defaultDuration`. */
  relationshipDuration: number | undefined;
  promiseTargets: PromiseTargetInfo[];
}): InventoryCategory[] {
  const { ownerID, otherID, range, currentItems, currentPromises, defaultDuration, peaceDuration, relationshipDuration, promiseTargets } = args;
  // The fixed, game-set durations bundle; default terms resolve their read-only duration by item type.
  const durations: DealDurations = { defaultDuration, peaceDuration, relationshipDuration };
  const ownerGives = (predicate: (i: TradeItem) => boolean): boolean =>
    currentItems.some((i) => i.fromPlayerID === ownerID && predicate(i));

  const itemRow = (
    key: string,
    label: string,
    legal: boolean,
    reasons: string[],
    selected: boolean,
    item: TradeItem,
    secondary?: string
  ): InventoryRow => ({ key, label, secondary, legal, reasons, selected, addPayload: { kind: 'item', item } });

  // An expandable header row: clicking it reveals its `targets`, each adding a fully-targeted term.
  const expandableRow = (key: string, label: string, targets: InventoryTarget[]): InventoryRow => ({
    key,
    label,
    secondary: `${targets.length} ${targets.length === 1 ? 'option' : 'options'}`,
    legal: true,
    reasons: [],
    selected: false,
    targets,
  });

  // 1. Gold + gold per turn.
  const gold: InventoryRow[] = [];
  if (range) {
    const goldSeed = Math.min(GOLD_SEED, range.gold.max);
    gold.push(itemRow(
      'GOLD', 'Gold', range.gold.available, range.gold.reasons,
      isSingletonSelected('GOLD', ownerID, currentItems),
      defaultItemFor('GOLD', ownerID, otherID, { gold: goldSeed }),
      range.gold.max ? `up to ${range.gold.max}` : undefined
    ));
    gold.push(itemRow(
      'GOLD_PER_TURN', 'Gold per turn', range.goldPerTurn.available, range.goldPerTurn.reasons,
      isSingletonSelected('GOLD_PER_TURN', ownerID, currentItems),
      defaultItemFor('GOLD_PER_TURN', ownerID, otherID, { durations })
    ));
  }

  // 2–3. Resources, bucketed by category. Bonus resources are never tradeable, so the inspect-deal
  // source omits them entirely — only luxury and strategic buckets exist here.
  const resourceRows = (category: 'luxury' | 'strategic'): InventoryRow[] =>
    (range?.resources ?? [])
      .filter((r) => r.category === category)
      .map((r) =>
        itemRow(
          `RES:${r.resourceID}`,
          r.name ?? `Resource #${r.resourceID}`,
          r.legal,
          r.reasons,
          ownerGives((i) => i.itemType === 'RESOURCES' && i.resourceID === r.resourceID),
          defaultItemFor('RESOURCES', ownerID, otherID, { resourceID: r.resourceID, durations }),
          `≤ ${r.quantityAvailable}`
        )
      );

  // 5. World Congress — "Vote commitment" expands into the in-session resolutions the range
  // enumerates. Each choice carries its full term (resolution, choice, the game-computed vote
  // count, enact/repeal), so picking it needs no further central editing. Hidden when no league
  // is in session (no candidates), like third-party rows.
  //
  // The DLL allows only ONE vote commitment per giver per deal (CvDeal::IsPossibleToTradeItem's
  // ContainsItemType guard). The range is enumerated against an empty scratch deal, so it can't
  // see the draft's existing commitment — replicate the rule here: once this side has any vote
  // commitment on the table, the others are blocked (red, with a reason) until it's removed.
  const sideHasVoteCommitment = ownerGives((i) => i.itemType === 'VOTE_COMMITMENT');
  const voteTargets: InventoryTarget[] = (range?.voteCommitments ?? []).map((v) => {
    const selected = ownerGives(
      (i) =>
        i.itemType === 'VOTE_COMMITMENT' &&
        i.resolutionID === v.resolutionID &&
        i.voteChoice === v.voteChoice &&
        !!i.repeal === v.repeal
    );
    const blockedByExisting = sideHasVoteCommitment && !selected;
    return {
      key: `VC:${v.resolutionID}:${v.voteChoice}:${v.repeal}`,
      label: v.name ?? `Resolution #${v.resolutionID}`,
      legal: v.legal && !blockedByExisting,
      reasons: blockedByExisting
        ? ['Only one vote commitment per deal — remove the current one first.']
        : v.reasons,
      selected,
      addPayload: {
        kind: 'item',
        item: {
          ...defaultItemFor('VOTE_COMMITMENT', ownerID, otherID),
          resolutionID: v.resolutionID,
          voteChoice: v.voteChoice,
          numVotes: v.numVotes,
          repeal: v.repeal,
        },
      },
    };
  });
  const congress: InventoryRow[] = voteTargets.length
    ? [expandableRow('VOTE_COMMITMENT', 'Vote commitment', voteTargets)]
    : [];

  // 6. Single-shot toggles (embassy, open borders, pacts, friendship, maps, peace, vassalage).
  // A ruleset-gated toggle (research agreement / vassalage) is ABSENT from the range when the
  // game option forbids it — skip it so it renders nowhere, rather than showing it red.
  const toggles: InventoryRow[] = range
    ? TOGGLE_ITEMS.flatMap((t) => {
        const cand = range[t.rangeKey] as CandidateLegality | undefined;
        if (!cand) return [];
        return [itemRow(
          t.itemType, t.label, cand.legal, cand.reasons,
          isSingletonSelected(t.itemType, ownerID, currentItems),
          defaultItemFor(t.itemType, ownerID, otherID, { durations })
        )];
      })
    : [];

  // 7. Cities.
  const cities: InventoryRow[] = (range?.cities ?? []).map((c) =>
    itemRow(
      `CITY:${c.cityID}`,
      c.name || `City #${c.cityID}`,
      c.legal,
      c.reasons,
      ownerGives((i) => i.itemType === 'CITIES' && i.cityID === c.cityID),
      defaultItemFor('CITIES', ownerID, otherID, { cityID: c.cityID })
    )
  );

  // 8. Technologies.
  const techs: InventoryRow[] = (range?.techs ?? []).map((t) =>
    itemRow(
      `TECH:${t.techID}`,
      t.name ? `Tech: ${t.name}` : `Tech #${t.techID}`,
      t.legal,
      t.reasons,
      ownerGives((i) => i.itemType === 'TECHS' && i.techID === t.techID),
      defaultItemFor('TECHS', ownerID, otherID, { techID: t.techID })
    )
  );

  // 9. Third-party peace / war — pick the target team from an expandable list (only if any exist).
  const thirdParty: InventoryRow[] = [];
  const peaceTargets: InventoryTarget[] = (range?.thirdPartyPeace ?? []).map((t) => ({
    key: `TPP:${t.teamID}`,
    label: t.name ?? `team ${t.teamID}`,
    legal: t.legal,
    reasons: t.reasons,
    selected: ownerGives((i) => i.itemType === 'THIRD_PARTY_PEACE' && i.thirdPartyTeamID === t.teamID),
    addPayload: { kind: 'item', item: defaultItemFor('THIRD_PARTY_PEACE', ownerID, otherID, { thirdPartyTeamID: t.teamID, durations }) },
  }));
  const warTargets: InventoryTarget[] = (range?.thirdPartyWar ?? []).map((t) => ({
    key: `TPW:${t.teamID}`,
    label: t.name ?? `team ${t.teamID}`,
    legal: t.legal,
    reasons: t.reasons,
    selected: ownerGives((i) => i.itemType === 'THIRD_PARTY_WAR' && i.thirdPartyTeamID === t.teamID),
    addPayload: { kind: 'item', item: defaultItemFor('THIRD_PARTY_WAR', ownerID, otherID, { thirdPartyTeamID: t.teamID }) },
  }));
  if (peaceTargets.length) thirdParty.push(expandableRow('TP_PEACE', 'Make peace with…', peaceTargets));
  if (warTargets.length) thirdParty.push(expandableRow('TP_WAR', 'Declare war on…', warTargets));

  // 10. Promises (the nine). A targeted promise expands to pick its third party (and never auto-selects
  // at the header); a non-targeted promise is a direct singleton-by-type.
  const promises: InventoryRow[] = PROMISE_TYPES.map((pt) => {
    if (PROMISE_NEEDS_TARGET.has(pt)) {
      return expandableRow(`PROMISE:${pt}`, PROMISE_LABELS[pt] ?? pt, promiseTargetsFor(pt, ownerID, otherID, promiseTargets, currentPromises));
    }
    return {
      key: `PROMISE:${pt}`,
      label: PROMISE_LABELS[pt] ?? pt,
      // Promise structural legality is a light entrypoint check, not part of the range; show all.
      legal: true,
      reasons: [],
      selected: currentPromises.some((p) => p.promiserID === ownerID && p.promiseType === pt),
      addPayload: { kind: 'promise', promise: { promiserID: ownerID, recipientID: otherID, promiseType: pt } },
    };
  });

  return [
    { kind: 'gold', title: 'Gold', rows: gold },
    { kind: 'luxury', title: 'Luxury resources', rows: resourceRows('luxury') },
    { kind: 'strategic', title: 'Strategic resources', rows: resourceRows('strategic') },
    { kind: 'congress', title: 'World Congress', rows: congress },
    { kind: 'toggles', title: 'Agreements', rows: toggles },
    { kind: 'cities', title: 'Cities', rows: cities },
    { kind: 'techs', title: 'Technologies', rows: techs },
    { kind: 'thirdParty', title: 'Third-party peace & war', rows: thirdParty },
    { kind: 'promises', title: 'Promises', rows: promises },
  ];
}
