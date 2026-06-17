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
import type { TradeItem } from "../deal-schema.js";

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

/** The tradable range one side could put on the table (legality + identity). */
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

/** Raw return shape of inspect-deal.lua. */
export interface InspectDealResult {
  items: InspectedItem[];
  /** Keyed by player ID (as string): what that side could give. */
  range: Record<string, SideRange>;
  /** Set when the in-game scratch deal could not be obtained. */
  error?: string;
}

let inspectDealFunctionInstance: LuaFunction | undefined;
/** Lazily constructed so the (file-reading) init runs on first use, not at import. */
const inspectDealFunction = () =>
  (inspectDealFunctionInstance ??= LuaFunction.fromFile(
    "inspect-deal.lua",
    "inspectDeal",
    ["playerAID", "playerBID", "proposedItems"]
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
