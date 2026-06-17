/**
 * Getter function to read a player's current strategy and store it with "In-Game AI" rationale
 */

import { knowledgeManager } from "../../server.js";
import { convertStrategyToNames } from "../../utils/knowledge/enum.js";
import { LuaFunction } from "../../bridge/lua-function.js";
import { createLogger } from "../../utils/logger.js";
import { composeVisibility } from "../../utils/knowledge/visibility.js";

const logger = createLogger("ReadPlayerStrategies");

// Create a reusable LuaFunction for reading player strategies
let readPlayerStrategiesFunctionInstance: LuaFunction | undefined;
/** Lazily constructed so the (file-reading) init runs on first use, not at import. */
const readPlayerStrategiesFunction = () => (readPlayerStrategiesFunctionInstance ??= new LuaFunction(
  "readPlayerStrategies",
  ["playerId"],
  `
    local player = Players[playerId]
    if player == nil then
      return nil
    end

    -- Get current strategies
    local grandStrategy = player:GetGrandStrategy()
    local economicStrategies = player:GetEconomicStrategies()
    local militaryStrategies = player:GetMilitaryStrategies()

    return {
      GrandStrategy = grandStrategy,
      EconomicStrategies = economicStrategies,
      MilitaryStrategies = militaryStrategies
    }
  `
));

/**
 * Reads the current strategy of a player and stores it in the knowledge database
 * with the rationale set as "In-Game AI"
 *
 * @param playerId - The ID of the player (0 to MaxMajorCivs - 1)
 * @returns Object containing the current strategies or null if failed
 */
export async function getPlayerStrategy(playerId: number): Promise<{
  GrandStrategy: string | undefined;
  EconomicStrategies: string[];
  MilitaryStrategies: string[];
} | null> {
  // Execute the registered Lua function to get current strategies
  const result = await readPlayerStrategiesFunction().execute(playerId);

  if (!result || !result.success || !result.result) {
    logger.error(`Failed to read strategies for player ${playerId}`);
    return null;
  }

  const strategies = result.result;

  // Handle empty table conversion (Lua returns empty tables as objects)
  if (Object.keys(strategies.EconomicStrategies).length === 0) {
    strategies.EconomicStrategies = [];
  }
  if (Object.keys(strategies.MilitaryStrategies).length === 0) {
    strategies.MilitaryStrategies = [];
  }

  // Convert numeric IDs to string names for return value
  const readableStrategies = convertStrategyToNames(strategies);

  // Store the strategy in the knowledge database with "In-Game AI" rationale
  const store = knowledgeManager.getStore();
  const lastRationale = (await store.getMutableKnowledge("StrategyChanges", playerId))?.Rationale ?? "Unknown";
  await store.storeMutableKnowledge(
    'StrategyChanges',
    playerId,
    {
      GrandStrategy: readableStrategies.GrandStrategy,
      EconomicStrategies: readableStrategies.EconomicStrategies,
      MilitaryStrategies: readableStrategies.MilitaryStrategies,
      Rationale: lastRationale.startsWith("Tweaked by In-Game AI") ? lastRationale : `Tweaked by In-Game AI(${lastRationale.trim()})`
    },
    composeVisibility([playerId]),
    ["Rationale"] // Only ignore Rationale when checking for changes
  );
  
  return readableStrategies as any;
}