/**
 * @module strategist/pacing/important-events
 */

import { extractPlayerID, extractTeamID, flattenEvents, getPlayerTeamID } from "./utils.js";
import type { PacingInterruptionContext, PacingInterruptionStrategy } from "./types.js";

const warOrPeaceEventTypes = new Set(["DeclareWar", "MakePeace"]);
const researchEventTypes = new Set(["TeamTechResearched", "TeamSetHasTech"]);
const cultureEventTypes = new Set(["PlayerAdoptPolicy", "PlayerAdoptPolicyBranch", "IdeologyAdopted"]);
const relayedMessageEventType = "RelayedMessage";
const relayedMessageImportanceThreshold = 7;

/**
 * Forces a decision when the player reaches an event that can change priorities.
 */
export class ImportantEventsPacingInterruption implements PacingInterruptionStrategy {
  readonly name = "importantEvents";
  readonly label = "Important events";
  readonly description = "Force a decision when this player enters war or peace, completes research, adopts culture, or receives a high-importance relay.";

  /**
   * Return true when the cached event stream includes an important event for this player.
   */
  shouldInterrupt({ state, playerID }: PacingInterruptionContext): boolean {
    const events = flattenEvents(state.events);
    for (const event of events) {
      if (isImportantRelayedMessageForPlayer(event, playerID)) return true;
    }

    const ownTeamID = getPlayerTeamID(state.players, playerID);
    if (ownTeamID === undefined) return false;

    for (const event of events) {
      if (isWarOrPeaceForTeam(event, ownTeamID, state.players)) return true;
      if (isResearchCompletedForTeam(event, ownTeamID)) return true;
      if (isCultureAdoptedForPlayer(event, playerID)) return true;
    }
    return false;
  }
}

/**
 * Return true for war or peace events involving the player's team.
 *
 * Reads the consolidated `get-events` shape: `cleanEventData` rewrites the raw
 * `OriginatingPlayerID`/`TargetTeamID` to `OriginatingPlayer`/`TargetTeam`, but those
 * are NOT bare numbers — `OriginatingPlayer` is a `"<id>: <Civ>"` string (or a number
 * when unresolved) and `TargetTeam` is an object with an embedded `.ID` (or a number
 * when the team object is empty). Use the extraction helpers to read either form.
 */
function isWarOrPeaceForTeam(
  event: Record<string, unknown>,
  ownTeamID: number,
  players: PacingInterruptionContext["state"]["players"]
): boolean {
  if (typeof event.Type !== "string" || !warOrPeaceEventTypes.has(event.Type)) return false;

  const originatingPlayerID = extractPlayerID(event.OriginatingPlayer);
  if (
    originatingPlayerID !== undefined &&
    getPlayerTeamID(players, originatingPlayerID) === ownTeamID
  ) {
    return true;
  }

  return extractTeamID(event.TargetTeam) === ownTeamID;
}

/**
 * Return true for technology completion or gain events involving the player's team.
 *
 * Reads the consolidated `get-events` shape: `TeamID` becomes `Team`, which is an
 * object with an embedded `.ID` (or a bare number when the team object is empty), so
 * `extractTeamID` is used. For `TeamSetHasTech`, `HasTech` is present only when `true`
 * (a `false`/`0` loss is dropped by `cleanEventData`). For `TeamTechResearched`, a
 * tech-loss `ChangeAmount` of `-1` is likewise dropped, so completion requires a
 * positive numeric amount.
 */
function isResearchCompletedForTeam(event: Record<string, unknown>, ownTeamID: number): boolean {
  if (typeof event.Type !== "string" || !researchEventTypes.has(event.Type)) return false;
  if (extractTeamID(event.Team) !== ownTeamID) return false;

  if (event.Type === "TeamSetHasTech") {
    return event.HasTech === true || event.HasTech === 1;
  }

  return typeof event.ChangeAmount === "number" && event.ChangeAmount > 0;
}

/**
 * Return true for culture adoption events performed by this player.
 *
 * Reads the consolidated `get-events` shape: `PlayerID` becomes `Player`, which is a
 * `"<id>: <Civ>"` string (or a number when unresolved), so `extractPlayerID` is used.
 */
function isCultureAdoptedForPlayer(event: Record<string, unknown>, playerID: number): boolean {
  return typeof event.Type === "string" &&
    cultureEventTypes.has(event.Type) &&
    extractPlayerID(event.Player) === playerID;
}

/**
 * Return true for analyst-relayed messages marked urgent enough for a new decision.
 */
function isImportantRelayedMessageForPlayer(event: Record<string, unknown>, playerID: number): boolean {
  return event.Type === relayedMessageEventType &&
    event.ToPlayerID === playerID &&
    typeof event.Importance === "number" &&
    event.Importance >= relayedMessageImportanceThreshold;
}
