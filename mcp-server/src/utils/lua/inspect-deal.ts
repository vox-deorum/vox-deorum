/**
 * Read-only deal inspection bridge: constructs a transient scratch deal in-game and
 * reads back per-term legality/reasons/value plus the full tradable range per side.
 *
 * Mirrors present-decision.ts — a preregistered Lua function (inspect-deal.lua)
 * invoked over the bridge batch queue. The proposed items travel as a structured
 * argument: the bridge JSON-serializes the args array and the DLL's
 * ConvertJsonToLuaValue rebuilds it as a native Lua table (so the script reads
 * `item.itemType` etc. directly, with no JSON parsing in Lua). The scratch deal is
 * never activated — pure inspection (specs.md §4, stage 3).
 */

import { LuaFunction } from "../../bridge/lua-function.js";
import { createLogger } from "../logger.js";
import type { TradeItem, PromiseTerm } from "../deal-schema.js";

const logger = createLogger("InspectDeal");

/** Per-proposed-term inspection result, as returned by inspect-deal.lua. */
export interface InspectedItem {
  fromPlayerID: number;
  toPlayerID: number;
  itemType: string;
  /** Structural legality under bTreatAsHumanToHuman = true (matches enactment). */
  legal: boolean;
  /** Reason string when illegal (may be empty if the stock reason API is silent). */
  reason: string;
  /** AI value to the giver of parting with the item (may be INT_MAX; advisory only). */
  valueToGiver: number;
  /** AI value to the receiver of gaining the item (may be INT_MAX; advisory only). */
  valueToReceiver: number;
  /** Present and true when the item type was unrecognized. */
  unknown?: boolean;
}

/** Advisory both-direction value carried by an enumerated candidate (what the giver loses parting
 *  with it / what the receiver gains taking it). Both may be INT_MAX-scale sentinels; advisory only. */
export interface CandidateValue {
  valueToGiver?: number;
  valueToReceiver?: number;
}

/** Structural legality + raw reason carried by a single-shot toggle candidate. */
export interface ToggleCandidate extends CandidateValue {
  legal: boolean;
  /** Raw DLL reason string when illegal (color/newline tags; stripped in the tool layer). */
  reason: string;
}

/** A resource the giver holds and could put on the table. */
export interface ResourceCandidate extends CandidateValue {
  resourceID: number;
  /** Localized resource name (e.g. "Iron"); falls back to the ID in the UI when absent. */
  name?: string;
  /** In-game trade-screen bucket. */
  category?: "luxury" | "strategic" | "bonus";
  quantityAvailable: number;
  legal: boolean;
  reason: string;
}

/** One of the giver's cities offered on the table. */
export interface CityCandidate extends CandidateValue {
  cityID: number;
  name: string;
  x: number;
  y: number;
  /** Current city population (citizens). */
  population?: number;
  /** Current hit points (MaxHitPoints - Damage) and the maximum, for a sense of the city's resilience. */
  hitPoints?: number;
  maxHitPoints?: number;
  legal: boolean;
  reason: string;
}

/** A technology the giver knows and the receiver lacks. */
export interface TechCandidate extends CandidateValue {
  techID: number;
  /** Localized technology name; falls back to the ID in the UI when absent. */
  name?: string;
  legal: boolean;
  reason: string;
}

/** A third-party team for a third-party peace/war term. */
export interface ThirdPartyTeamCandidate extends CandidateValue {
  teamID: number;
  /** Display name of a representative civ on the team; falls back to the team ID when absent. */
  name?: string;
  legal: boolean;
  reason: string;
}

/**
 * One World Congress vote commitment the giver could put on the table — an in-session
 * enact/repeal proposal paired with one of its voter choices. The committed vote count is
 * the DLL's GetPotentialVotesForMember (the giver's remaining votes, adjusted by the
 * receiver's diplomat presence), not all the giver's votes.
 */
export interface VoteCommitmentCandidate extends CandidateValue {
  resolutionID: number;
  voteChoice: number;
  /** Votes the giver would commit (the game's computed amount, fixed at selection). */
  numVotes: number;
  /** True for a repeal proposal, false for an enact proposal. */
  repeal: boolean;
  /** Display name: resolution name + " — " + choice text (repeals prefixed "Repeal: "). */
  name?: string;
  legal: boolean;
  reason: string;
}

/**
 * The tradable range one side could put on the table. Each candidate carries its own
 * structural legality + raw reason so a structurally-impossible row stays visible
 * (red) rather than being dropped (stage 4). Reason strings are raw here and stripped
 * of color/newline tags in the inspect-deal tool layer.
 *
 * `researchAgreement` / `vassalage` / `vassalageRevoke` are OPTIONAL: the Lua omits them
 * entirely when the ruleset forbids the whole category (research agreements / vassalage game
 * options off), so the pocket is hidden rather than shown red. Tech trading is hidden the same
 * way but degrades to an empty `techs` array.
 */
export interface SideRange {
  /** The giver's net income per turn (CalculateGoldRate); context for how much GPT it can sustain. */
  netGoldPerTurn?: number;
  gold: { available: boolean; max: number; reason?: string };
  goldPerTurn: { available: boolean; reason?: string };
  maps: ToggleCandidate;
  openBorders: ToggleCandidate;
  defensivePact: ToggleCandidate;
  researchAgreement?: ToggleCandidate;
  peaceTreaty: ToggleCandidate;
  allowEmbassy: ToggleCandidate;
  declarationOfFriendship: ToggleCandidate;
  vassalage?: ToggleCandidate;
  vassalageRevoke?: ToggleCandidate;
  resources: ResourceCandidate[];
  cities: CityCandidate[];
  techs: TechCandidate[];
  thirdPartyPeace: ThirdPartyTeamCandidate[];
  thirdPartyWar: ThirdPartyTeamCandidate[];
  voteCommitments: VoteCommitmentCandidate[];
}

/** An eligible third-party promise target (Coop War → major; city-state promises → minor). */
export interface PromiseTargetInfo {
  playerID: number;
  teamID: number;
  /** Display name (civ short description, or "City-State <name>"); falls back to the ID. */
  name?: string;
  kind: "major" | "minor";
  /**
   * Coop War (major targets): whether a coop war between the two principals against this
   * civ is structurally valid (both pass IsValidCoopWarTarget). Absent on a DLL build
   * without the IsValidCoopWarTarget binding — treat absence as "unknown" (show anyway).
   */
  coopWarEligible?: boolean;
  /**
   * City-state promises (minor targets): which of the two principals currently protect this
   * city-state — i.e. valid recipients of a "stop bullying / don't attack my protected
   * city-state" promise. Omitted when neither protects it.
   */
  protectingPlayerIDs?: number[];
}

/** Raw return shape of inspect-deal.lua. */
export interface InspectDealResult {
  items: InspectedItem[];
  /** Keyed by player ID (as string): what that side could give. */
  range: Record<string, SideRange>;
  /** The game's default deal duration in turns (Game.GetDealDuration). */
  defaultDuration?: number;
  /** The game's peace-deal duration in turns (Game.GetPeaceDuration); used for peace items. */
  peaceDuration?: number;
  /** The game's relationship duration in turns (Game.GetRelationshipDuration); used for Declaration of Friendship. */
  relationshipDuration?: number;
  /** Military promise binding window in turns (flat; Game.GetMilitaryPromiseDuration). */
  militaryPromiseDuration?: number;
  /** Expansion promise binding window in turns (Game.GetExpansionPromiseDuration). */
  expansionPromiseDuration?: number;
  /** Border promise binding window in turns (Game.GetBorderPromiseDuration). */
  borderPromiseDuration?: number;
  /** Coop War preparation countdown in turns before the joint war auto-declares (COOP_WAR_SOON_COUNTER). */
  coopWarPromiseDuration?: number;
  /** Eligible third-party promise targets with display names and major/minor kind. */
  promiseTargets?: PromiseTargetInfo[];
  /** Set when the in-game scratch deal could not be obtained. */
  error?: string;
}

/**
 * Result of an enact-mode inspect-deal call (the game-write path). Enactment validates every
 * trade item and promise before any write; on refusal nothing is written and `enacted` is false
 * with per-term `reasons`. The trade items are enacted first via `Deal:Enact` (the fallible step);
 * only on success are the promises applied best-effort via `Player:SetPromise` (no rollback, since
 * validity is vetted up front).
 */
export interface EnactDealResult {
  /** True when the trade items were enacted for real (Deal:Enact returned true). */
  enacted: boolean;
  /** Refusal / failure reasons, present and non-empty only when `enacted` is false. */
  reasons?: string[];
  /** Per-item structural legality (diagnostics; same shape as read-only inspection). */
  items?: InspectedItem[];
}

let inspectDealFunctionInstance: LuaFunction | undefined;
/** Lazily constructed so the (file-reading) init runs on first use, not at import. The optional
 *  fourth `enact` argument (absent in read-only inspection) switches the script to enact mode. */
const inspectDealFunction = () =>
  (inspectDealFunctionInstance ??= LuaFunction.fromFile(
    "inspect-deal.lua",
    "inspectDeal",
    ["playerAID", "playerBID", "proposedItems", "enact"]
  ));

/** Accept both the live bridge's direct return object and older array-wrapped mocks. */
function unwrapInspectDealResult(result: unknown): InspectDealResult | undefined {
  if (Array.isArray(result)) return result[0] as InspectDealResult | undefined;
  return result as InspectDealResult | undefined;
}

/**
 * Inspect a (possibly empty) proposed deal between two major civs.
 *
 * @param playerAID - One major-civ player ID
 * @param playerBID - The other major-civ player ID
 * @param proposedItems - The structured trade items to evaluate (may be empty)
 * @returns Per-term legality/value plus the tradable range per side, or null on bridge failure
 */
export async function inspectDeal(
  playerAID: number,
  playerBID: number,
  proposedItems: TradeItem[]
): Promise<InspectDealResult | null> {
  const response = await inspectDealFunction().execute(playerAID, playerBID, proposedItems);

  if (!response.success || response.result === undefined || response.result === null) {
    logger.error(`inspect-deal failed for players ${playerAID}/${playerBID}`, { error: response.error });
    return null;
  }

  const result = unwrapInspectDealResult(response.result);
  if (!result) {
    logger.error(`inspect-deal returned an empty result for players ${playerAID}/${playerBID}`);
    return null;
  }
  if (result?.error) {
    logger.error(`inspect-deal returned an error for players ${playerAID}/${playerBID}: ${result.error}`);
    return null;
  }
  return result;
}

/**
 * Enact a complete deal between two major civs: the game-write path (stage 6). Runs the whole
 * validate, then enact-items, then apply-promises sequence in one atomic Lua invocation, so
 * validation cannot go stale between check and act. Structurally-illegal items or already-made or
 * invalid promises refuse with per-term reasons and write nothing. The `bTreatAsHumanToHuman`
 * override is applied inside the script, so AI-only political restrictions do not gate the deal
 * while structural legality still does.
 *
 * @param playerAID - One major-civ player ID (the deal's from-player)
 * @param playerBID - The other major-civ player ID (the deal's to-player)
 * @param items - The ordinary trade items to enact (may be empty for a promise-only deal)
 * @param promises - The promise commitments to apply (may be empty for an items-only deal)
 * @returns The enactment result, or null on bridge failure (bridge down / malformed response)
 */
export async function enactDeal(
  playerAID: number,
  playerBID: number,
  items: TradeItem[],
  promises: PromiseTerm[]
): Promise<EnactDealResult | null> {
  const response = await inspectDealFunction().execute(playerAID, playerBID, items, { promises });

  if (!response.success || response.result === undefined || response.result === null) {
    logger.error(`enact-deal failed for players ${playerAID}/${playerBID}`, { error: response.error });
    return null;
  }

  // Reuse the read-only unwrap (both share the maybe-array-wrapped object shape), then read the
  // enact-mode fields off it.
  const result = unwrapInspectDealResult(response.result) as (EnactDealResult & { error?: string }) | undefined;
  if (!result) {
    logger.error(`enact-deal returned an empty result for players ${playerAID}/${playerBID}`);
    return null;
  }
  if (result.error) {
    logger.error(`enact-deal returned an error for players ${playerAID}/${playerBID}: ${result.error}`);
    return null;
  }
  return result;
}
