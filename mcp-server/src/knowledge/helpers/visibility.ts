import { Selectable } from "kysely";
import { MaxMajorCivs, PlayerVisibility } from "../schema/base.js";
import { PlayerSummary } from "../schema/timed.js";

/**
 * Marks the visibility of a knowledge item to specific players
 */
export function applyVisibility<T extends PlayerVisibility>(data: T, visibility?: number[]): T {
  if (!visibility) return data;
  for (let i = 0; i < MaxMajorCivs; i++) {
    (data as any)[`Player${i}`] = visibility[i];
  }
  return data;
}

/**
 * Parses visibility flags into a set of player IDs who can see the item
 */
export function parseVisibility<T extends PlayerVisibility>(data: T | Selectable<T>): number[] {
  const visibleTo: number[] = [];
  for (let i = 0; i < MaxMajorCivs; i++) {
    visibleTo.push((data as any)[`Player${i}`]);
  }
  return visibleTo;
}

/**
 * Checks if a knowledge item is visible to a specific player
 * Returns 2 if fully visible, 1 if partly visible, 0 if not visible
 */
export function getVisibility<T extends PlayerVisibility>(data: T | Selectable<T>, playerId: number): number {
  return (data as any)[`Player${playerId}`];
}

/**
 * Gets the visibility level that a player has of a target player
 *
 * @param playerSummaries - Array of PlayerSummary objects from the game
 * @param playerID - The ID of the viewing player
 * @param targetID - The ID of the target player being viewed
 * @returns Visibility level: 2 (team/full), 1 (met/partial), 0 (unmet), or null if target not found
 */
export function getPlayerVisibility(
  playerSummaries: Selectable<PlayerSummary>[],
  playerID: number | undefined,
  targetID: number
): number {
  if (playerID === undefined) return 2;
  // Find the target player's summary
  const targetSummary = playerSummaries.find(summary => summary.Key === targetID);
  // If target player not found, return null
  if (!targetSummary) return 2
  // Reuse the existing getVisibility function
  return getVisibility(targetSummary, playerID);
}

/**
 * Creates a visibility array for a list of player IDs
 * All specified players get visibility level 2, others get 0
 *
 * @param playerIDs - Array of player IDs that should have visibility
 * @returns Array of visibility levels indexed by player ID
 */
export function composeVisibility(playerIDs: number[]): number[] {
  const visibility: number[] = new Array(MaxMajorCivs).fill(0);
  for (const playerID of playerIDs) {
    if (playerID >= 0 && playerID < MaxMajorCivs) {
      visibility[playerID] = 2;
    }
  }
  return visibility;
}
