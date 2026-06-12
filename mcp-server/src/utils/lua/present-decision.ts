/**
 * Outbound human-control bridge: pushes a turn's decision options into the game
 * so the in-game panel can present them to the human strategist.
 *
 * Mirrors player-actions.ts — a preregistered Lua function invoked over the
 * bridge batch queue. The OptionsReport travels as a structured argument: the
 * bridge JSON-serializes the args array for transport, and the DLL's
 * ConvertJsonToLuaValue rebuilds it as a native Lua table before the panel sees
 * it (so the panel reads `options.Options.Technologies` etc. directly, with no
 * JSON parsing in Lua). It is never inline-interpolated into a script.
 */

import { LuaFunction } from "../../bridge/lua-function.js";
import type { LuaResponse } from "../../bridge/manager.js";
import { createLogger } from "../logger.js";

const logger = createLogger('PresentDecision');

/**
 * Preregistered Lua function that fires the human-decision options into the
 * panel. The OptionsReport travels as the structured argument `options`, which
 * arrives in Lua as a table (converted from JSON by the DLL).
 */
const presentDecisionFunction = new LuaFunction(
  "presentHumanDecision",
  ["playerID", "turn", "options"],
  `
    LuaEvents.VoxDeorumHumanDecision(playerID, turn, options)
    return true
  `
);

/**
 * Present a decision to the human-control panel: fires
 * LuaEvents.VoxDeorumHumanDecision(playerID, turn, options) into the game.
 *
 * @param playerID - The human strategist's player ID
 * @param turn - The turn the decision is for
 * @param options - The OptionsReport handed to the panel (a structured object;
 *   the DLL converts it to a Lua table over the bridge)
 */
export async function presentHumanDecision(
  playerID: number,
  turn: number,
  options: object
): Promise<LuaResponse> {
  const response = await presentDecisionFunction.execute(playerID, turn, options);

  if (response.success) {
    logger.debug(`[Turn ${turn}] Presented decision to player ${playerID}`);
  } else {
    logger.error(`[Turn ${turn}] Failed to present decision to player ${playerID}`, { error: response.error });
  }

  return response;
}
