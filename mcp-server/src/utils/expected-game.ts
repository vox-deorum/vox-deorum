/**
 * Shared game-identity guard for tools that accept an optional ExpectedGameID.
 * Rejects a guarded call once the MCP server is serving another game database.
 */

import { knowledgeManager } from "../server.js";

/**
 * Throw when the active game no longer matches the caller's expectation.
 * A no-op when the caller did not pass an ExpectedGameID.
 *
 * Call again after any await that can yield into a GameSwitched event, since the
 * active store can be replaced while earlier validation is in flight.
 *
 * @param toolName - Reporting name used in the thrown error message
 * @param expectedGameID - The caller's game identity guard, if any
 */
export function assertExpectedGame(toolName: string, expectedGameID: string | undefined): void {
  if (expectedGameID === undefined) return;
  const activeGameID = knowledgeManager.getGameId();
  if (activeGameID !== expectedGameID) {
    throw new Error(`${toolName} expected game ${expectedGameID}, but active game is ${activeGameID}`);
  }
}
