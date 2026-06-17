/**
 * Getter function to read a player's AI persona values and store them in the knowledge database
 */

import { knowledgeManager } from "../../server.js";
import { LuaFunction } from "../../bridge/lua-function.js";
import { createLogger } from "../../utils/logger.js";
import { PersonaChange } from "../schema/timed.js";
import { composeVisibility } from "../../utils/knowledge/visibility.js";

const logger = createLogger("ReadPlayerPersona");

// Create a reusable LuaFunction for reading player persona values
let readPlayerPersonaFunctionInstance: LuaFunction | undefined;
/** Lazily constructed so the (file-reading) init runs on first use, not at import. */
const readPlayerPersonaFunction = () => (readPlayerPersonaFunctionInstance ??= new LuaFunction(
  "readPlayerPersona",
  ["playerId"],
  `
    local player = Players[playerId]
    if player == nil then
      return nil
    end

    -- Get persona values (returns entire table)
    local persona = player:GetPersona()

    -- Return the entire persona table
    return persona
  `
));

/**
 * Reads the AI persona values of a player and stores them in the knowledge database
 *
 * @param playerId - The ID of the player (0 to MaxMajorCivs - 1)
 * @returns Object containing the persona values or null if failed
 */
export async function getPlayerPersona(playerId: number): Promise<Partial<PersonaChange> | null> {
  // Execute the registered Lua function to get persona values
  const result = await readPlayerPersonaFunction().execute(playerId);

  if (!result || !result.success || !result.result) {
    logger.error(`Failed to read persona for player ${playerId}`);
    return null;
  }

  const persona = result.result;

  // Store the persona values in the knowledge database with "In-Game AI" rationale
  const store = knowledgeManager.getStore();
  const lastRationale = (await store.getMutableKnowledge("PersonaChanges", playerId))?.Rationale ?? "Unknown";
  await store.storeMutableKnowledge(
    'PersonaChanges',
    playerId,
    {
      ...persona,
      // Metadata
      Rationale: lastRationale.startsWith("Tweaked by In-Game AI") ? lastRationale : `Tweaked by In-Game AI (${lastRationale.trim()})`
    },
    composeVisibility([playerId]),
    ["Rationale"] // Only ignore Rationale when checking for changes
  );

  // Return the persona values as-is (no enum conversion needed)
  return persona;
}