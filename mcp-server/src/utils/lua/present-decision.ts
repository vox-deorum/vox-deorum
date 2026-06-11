/**
 * Outbound human-control bridge: pushes a turn's decision options into the game
 * so the in-game panel can present them to the human strategist.
 *
 * Mirrors player-actions.ts — a preregistered Lua function invoked with
 * JSON-serialized string arguments over the bridge batch queue (the OptionsReport
 * travels as a string argument, never inline-interpolated into a script).
 */

import { LuaFunction } from "../../bridge/lua-function.js";
import type { LuaResponse } from "../../bridge/manager.js";
import { sanitize } from "./player-actions.js";
import { createLogger } from "../logger.js";

const logger = createLogger('PresentDecision');

/**
 * Preregistered Lua function that fires the human-decision options into the
 * panel. The OptionsReport travels as the JSON string argument `optionsJson`.
 */
const presentDecisionFunction = new LuaFunction(
  "presentHumanDecision",
  ["playerID", "turn", "optionsJson"],
  `
    LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson)
    return true
  `
);

/**
 * Present a decision to the human-control panel: fires
 * LuaEvents.VoxDeorumHumanDecision(playerID, turn, optionsJson) into the game.
 *
 * @param playerID - The human strategist's player ID
 * @param turn - The turn the decision is for
 * @param optionsJson - JSON-serialized options payload handed to the panel
 */
export async function presentHumanDecision(
  playerID: number,
  turn: number,
  optionsJson: string
): Promise<LuaResponse> {
  const response = await presentDecisionFunction.execute(playerID, turn, sanitize(optionsJson));

  if (response.success) {
    logger.debug(`[Turn ${turn}] Presented decision to player ${playerID} (${optionsJson.length} bytes)`);
  } else {
    logger.error(`[Turn ${turn}] Failed to present decision to player ${playerID}`, { error: response.error });
  }

  return response;
}
