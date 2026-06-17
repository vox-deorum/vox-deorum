/**
 * Getter function to read a player's custom flavor values from the game
 */

import { LuaFunction } from "../../bridge/lua-function.js";
import { createLogger } from "../../utils/logger.js";
import { knowledgeManager } from "../../server.js";
import { composeVisibility } from "../../utils/knowledge/visibility.js";
import { FlavorChange } from "../schema/timed.js";
import { loadFlavorDescriptions } from "../../utils/strategies/loader.js";
import { pascalCase } from "change-case";
import { retrieveEnumName } from "../../utils/knowledge/enum.js";

const logger = createLogger("ReadPlayerFlavors");

// Create a reusable LuaFunction for reading player custom flavors and grand strategy
let readPlayerFlavorsFunctionInstance: LuaFunction | undefined;
/** Lazily constructed so the (file-reading) init runs on first use, not at import. */
const readPlayerFlavorsFunction = () => (readPlayerFlavorsFunctionInstance ??= new LuaFunction(
  "readPlayerFlavors",
  ["playerId"],
  `
    local player = Players[playerId]
    if player == nil then
      return nil
    end

    -- Get custom flavor values (only those explicitly set via SetCustomFlavors)
    local flavors = player:GetCustomFlavors()
    local grandStrategy = player:GetGrandStrategy()

    return {
      Flavors = flavors,
      GrandStrategy = grandStrategy
    }
  `
));

/**
 * Reads the current custom flavor values and grand strategy, stores them in the knowledge database
 *
 * @param playerId - The ID of the player (0 to MaxMajorCivs - 1)
 * @returns Object containing the current custom flavors and grand strategy or null if none are set
 */
export async function getPlayerFlavors(playerId: number): Promise<FlavorChange | null> {
  // Execute the Lua function to get custom flavors and grand strategy
  const result = await readPlayerFlavorsFunction().execute(playerId);

  if (!result || !result.success || !result.result) {
    logger.error(`Failed to read flavors for player ${playerId}`);
    return null;
  }

  const data = result.result;
  const flavors = data.Flavors;
  const grandStrategyId = data.GrandStrategy;

  // Check if any custom flavors are set
  if (!flavors || Object.keys(flavors).length === 0) {
    logger.debug(`No custom flavors set for player ${playerId}`);
    return null;
  }

  // Load all available flavors from the cache to ensure we include zeros
  const allFlavors = await loadFlavorDescriptions();

  // Initialize cleanedFlavors with all flavors set to 50 (balanced in MCP range)
  const cleanedFlavors: Record<string, number> = {};
  for (const flavorName of Object.keys(allFlavors)) {
    cleanedFlavors[flavorName] = 50;
  }

  // Update with actual values from the game, converting to PascalCase
  // GetCustomFlavors now returns MCP range (0-100) directly
  for (const [key, value] of Object.entries(flavors)) {
    const withoutPrefix = key.replace(/^FLAVOR_/, '');
    const pascalKey = pascalCase(withoutPrefix);
    cleanedFlavors[pascalKey] = value as number; // Already in MCP range
  }

  // Convert grand strategy ID to name
  const grandStrategyName = retrieveEnumName("GrandStrategy", grandStrategyId) ?? "Unknown";

  // Store the flavors and grand strategy in the knowledge database
  const store = knowledgeManager.getStore();
  const lastRationale = (await store.getMutableKnowledge("FlavorChanges", playerId))?.Rationale ?? "Unknown";

  await store.storeMutableKnowledge(
    'FlavorChanges',
    playerId,
    {
      Key: playerId,
      ...cleanedFlavors,
      GrandStrategy: grandStrategyName,
      Rationale: lastRationale.startsWith("Tweaked by In-Game AI") ? lastRationale : `Tweaked by In-Game AI(${lastRationale.trim()})`
    },
    composeVisibility([playerId]),
    ["Rationale"] // Only ignore Rationale when checking for changes
  );

  return {
    Key: playerId,
    ...cleanedFlavors,
    GrandStrategy: grandStrategyName,
    Rationale: lastRationale
  } as FlavorChange;
}