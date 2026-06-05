/**
 * @module strategist/pacing/important-events
 */

import { flattenEvents, getPlayerTeamID } from "./utils.js";
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
 * Reads the consolidated `get-events` field names: `cleanEventData` rewrites the raw
 * `OriginatingPlayerID`/`TargetTeamID` to `OriginatingPlayer`/`TargetTeam` (numeric
 * values preserved).
 */
function isWarOrPeaceForTeam(
  event: Record<string, unknown>,
  ownTeamID: number,
  players: PacingInterruptionContext["state"]["players"]
): boolean {
  if (typeof event.Type !== "string" || !warOrPeaceEventTypes.has(event.Type)) return false;

  const originatingPlayerID = event.OriginatingPlayer;
  if (
    typeof originatingPlayerID === "number" &&
    getPlayerTeamID(players, originatingPlayerID) === ownTeamID
  ) {
    return true;
  }

  return event.TargetTeam === ownTeamID;
}

/**
 * Return true for technology completion or gain events involving the player's team.
 *
 * Reads the consolidated `get-events` field names: `TeamID` becomes `Team`. For
 * `TeamSetHasTech`, `HasTech` is present only when `true` (a `false`/`0` loss is
 * dropped by `cleanEventData`). For `TeamTechResearched`, a tech-loss `ChangeAmount`
 * of `-1` is likewise dropped, so completion requires a positive numeric amount.
 */
function isResearchCompletedForTeam(event: Record<string, unknown>, ownTeamID: number): boolean {
  if (typeof event.Type !== "string" || !researchEventTypes.has(event.Type)) return false;
  if (event.Team !== ownTeamID) return false;

  if (event.Type === "TeamSetHasTech") {
    return event.HasTech === true || event.HasTech === 1;
  }

  return typeof event.ChangeAmount === "number" && event.ChangeAmount > 0;
}

/**
 * Return true for culture adoption events performed by this player.
 *
 * Reads the consolidated `get-events` field name: `PlayerID` becomes `Player`.
 */
function isCultureAdoptedForPlayer(event: Record<string, unknown>, playerID: number): boolean {
  return typeof event.Type === "string" &&
    cultureEventTypes.has(event.Type) &&
    event.Player === playerID;
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
