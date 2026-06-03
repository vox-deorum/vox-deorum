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

    for (const event of flattenEvents(state.events)) {
      if (event.Type !== "DeclareWar" && event.Type !== "MakePeace") continue;
      // Compare both sides in team space: resolve the originating player's team
      // (so teammate-initiated wars also count) and the target team. This avoids
      // mixing player-ID and team-ID spaces. Self-origination is covered because
      // the player resolves to its own team.
      const originatingPlayerID = event.OriginatingPlayerID;
      if (typeof originatingPlayerID === "number" &&
          getPlayerTeamID(state.players, originatingPlayerID) === ownTeamID) return true;
      if (event.TargetTeamID === ownTeamID) return true;
    }
    return false;
  }
}
