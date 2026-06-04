/**
 * @module strategist/pacing/important-events
 */

import { flattenEvents, getPlayerTeamID } from "./utils.js";
import type { PacingInterruptionContext, PacingInterruptionStrategy } from "./types.js";

const warOrPeaceEventTypes = new Set(["DeclareWar", "MakePeace"]);
const researchEventTypes = new Set(["TeamTechResearched", "TeamSetHasTech"]);
const cultureEventTypes = new Set(["PlayerAdoptPolicy", "PlayerAdoptPolicyBranch", "IdeologyAdopted"]);

/**
 * Forces a decision when the player reaches an event that can change priorities.
 */
export class ImportantEventsPacingInterruption implements PacingInterruptionStrategy {
  readonly name = "importantEvents";
  readonly label = "Important events";
  readonly description = "Force a decision when this player enters war or peace, completes research, or adopts culture.";

  /**
   * Return true when the cached event stream includes an important event for this player.
   */
  shouldInterrupt({ state, playerID }: PacingInterruptionContext): boolean {
    const ownTeamID = getPlayerTeamID(state.players, playerID);
    if (ownTeamID === undefined) return false;

    for (const event of flattenEvents(state.events)) {
      if (isWarOrPeaceForTeam(event, ownTeamID, state.players)) return true;
      if (isResearchCompletedForTeam(event, ownTeamID)) return true;
      if (isCultureAdoptedForPlayer(event, playerID)) return true;
    }
    return false;
  }
}

/**
 * Return true for war or peace events involving the player's team.
 */
function isWarOrPeaceForTeam(
  event: Record<string, unknown>,
  ownTeamID: number,
  players: PacingInterruptionContext["state"]["players"]
): boolean {
  if (typeof event.Type !== "string" || !warOrPeaceEventTypes.has(event.Type)) return false;

  const originatingPlayerID = event.OriginatingPlayerID;
  if (
    typeof originatingPlayerID === "number" &&
    getPlayerTeamID(players, originatingPlayerID) === ownTeamID
  ) {
    return true;
  }

  return event.TargetTeamID === ownTeamID;
}

/**
 * Return true for technology completion or gain events involving the player's team.
 */
function isResearchCompletedForTeam(event: Record<string, unknown>, ownTeamID: number): boolean {
  if (typeof event.Type !== "string" || !researchEventTypes.has(event.Type)) return false;
  if (event.TeamID !== ownTeamID) return false;

  if (event.Type === "TeamSetHasTech") {
    return event.HasTech === true || event.HasTech === 1;
  }

  return typeof event.ChangeAmount !== "number" || event.ChangeAmount > 0;
}

/**
 * Return true for culture adoption events performed by this player.
 */
function isCultureAdoptedForPlayer(event: Record<string, unknown>, playerID: number): boolean {
  return typeof event.Type === "string" &&
    cultureEventTypes.has(event.Type) &&
    event.PlayerID === playerID;
}
