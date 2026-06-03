/**
 * @module strategist/pacing/war-or-peace
 */

import { flattenEvents, getPlayerTeamID } from "./utils.js";
import type { PacingInterruptionContext, PacingInterruptionStrategy } from "./types.js";

/**
 * Forces a decision when diplomacy changes for the player's team.
 */
export class WarOrPeacePacingInterruption implements PacingInterruptionStrategy {
  readonly name = "warOrPeace";
  readonly label = "War or peace";
  readonly description = "Force a decision when this player declares war, is declared on, or makes peace.";

  shouldInterrupt({ state, playerID }: PacingInterruptionContext): boolean {
    const ownTeamID = getPlayerTeamID(state.players, playerID);
    if (ownTeamID === undefined) return false;

    // Civ V war/peace events are team-targeted, so target checks compare
    // against TeamID while originating checks still use the player ID.
    for (const event of flattenEvents(state.events)) {
      if (event.Type !== "DeclareWar" && event.Type !== "MakePeace") continue;
      if (event.OriginatingPlayerID === playerID) return true;
      if (event.TargetTeamID === ownTeamID) return true;
    }
    return false;
  }
}
