/**
 * Unified player action dispatch for observer mods and replay messages.
 * Uses preregistered Lua functions to avoid repeated script compilation.
 * Fires LuaEvents for observer consumption and optionally writes replay messages.
 */

import { LuaFunction } from "../../bridge/lua-function.js";
import { knowledgeManager } from "../../server.js";
import { createLogger } from "../logger.js";

const logger = createLogger('PlayerActions');

/**
 * Strip control characters that could break C++ JSON parsing.
 * Preserves tabs (\t), newlines (\n), and carriage returns (\r).
 */
export function sanitize(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Preregistered Lua function for player actions.
 * Parameters are passed as JSON-serialized values via the bridge batch queue.
 * replayPrefix: false = no replay, "" = replay without prefix, "X" = replay with prefix "X: "
 */
const actionFunction = new LuaFunction(
  "registerAction",
  ["playerID", "actionType", "summary", "rationale", "replayPrefix", "turn"],
  `
    LuaEvents.VoxDeorumAction(playerID, turn, actionType, summary, rationale)

    if replayPrefix then
      local msg
      if replayPrefix ~= "" then
        msg = replayPrefix .. ": " .. summary
      else
        msg = summary
      end
      if rationale ~= "" then
        msg = msg .. ". Rationale: " .. rationale
      end
      Players[playerID]:AddReplayMessage(msg)
    end

    return true
  `
);

/**
 * Preregistered Lua function for player info events.
 */
const playerInfoFunction = new LuaFunction(
  "setPlayerInfo",
  ["playerID", "label"],
  `
    LuaEvents.VoxDeorumPlayerInfo(playerID, label)
    return true
  `
);

/**
 * Push a player action: fires a LuaEvent for observer mods and optionally writes a replay message.
 *
 * @param playerID - The player performing the action
 * @param actionType - Action category (strategy, research, policy, relationship, persona, flavors, unset-flavors, status-quo)
 * @param summary - Clean summary of what changed (no prefix)
 * @param rationale - Why the action was taken
 * @param replayPrefix - Controls replay behavior:
 *   - undefined (omitted): event only, no replay message
 *   - "" (empty): replay without prefix: "{summary}. Rationale: {rationale}"
 *   - "Strategies" etc.: replay with prefix: "{prefix}: {summary}. Rationale: {rationale}"
 */
export async function pushPlayerAction(
  playerID: number,
  actionType: string,
  summary: string,
  rationale: string,
  replayPrefix?: string,
  turn?: number
): Promise<void> {
  const effectiveTurn = turn !== undefined && turn >= 0 ? turn : knowledgeManager.getTurn();
  // Pass false for no replay (Lua falsy), or the prefix string (Lua truthy, including "")
  const response = await actionFunction.execute(
    playerID,
    sanitize(actionType),
    sanitize(summary),
    sanitize(rationale),
    replayPrefix !== undefined ? replayPrefix : false,
    effectiveTurn
  );

  if (response.success) {
    logger.debug(`[Turn ${effectiveTurn}] Pushed ${actionType} action for player ${playerID}`);
  } else {
    logger.error(`[Turn ${effectiveTurn}] Failed to push ${actionType} action for player ${playerID}`, { error: response.error });
  }
}

/**
 * Push player info event: fires LuaEvents.VoxDeorumPlayerInfo for observer mods.
 *
 * @param playerID - The player ID
 * @param label - Combined model/strategist label (e.g. "deepseek-r1 / simple-strategist")
 */
export async function pushPlayerInfo(
  playerID: number,
  label: string
): Promise<void> {
  const response = await playerInfoFunction.execute(playerID, sanitize(label));

  if (response.success) {
    logger.debug(`Pushed player info for player ${playerID}: ${label}`);
  } else {
    logger.error(`Failed to push player info for player ${playerID}`, { error: response.error });
  }
}
