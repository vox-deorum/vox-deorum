/**
 * Tool for setting custom flavor values for a player in Civilization V
 */

import { ActionTool, sourceTurnField } from "../abstract/action.js";
import * as z from "zod";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { composeVisibility } from "../../knowledge/helpers/visibility.js";
import { pascalCase } from "change-case";
import { retrieveEnumName, retrieveEnumValue } from "../../knowledge/helpers/enum.js";
import { loadFlavorDescriptions } from "../../utils/strategies/loader.js";
import { FlavorChange } from "../../knowledge/schema/timed.js";
import { Insertable } from "kysely";

/**
 * Schema for the result returned by the Lua script
 */
const SetFlavorsResultSchema = z.object({
  Changed: z.boolean(),
  GrandStrategy: z.number(),
  Flavors: z.record(z.string(), z.number())
});

type SetFlavorsResultType = z.infer<typeof SetFlavorsResultSchema>;

/**
 * Convert PascalCase flavor keys to FLAVOR_ format
 */
function convertToFlavorFormat(key: string): string {
  // Split at capital letters, but keep consecutive capitals together
  let result = '';
  for (let i = 0; i < key.length; i++) {
    const char = key[i];
    const nextChar = key[i + 1];

    // Add underscore before capital letter if:
    // - It's not the first character
    // - Previous char was lowercase OR next char is lowercase
    if (i > 0 && char === char.toUpperCase() &&
        (key[i - 1] === key[i - 1].toLowerCase() ||
         (nextChar && nextChar === nextChar.toLowerCase()))) {
      result += '_';
    }
    result += char.toUpperCase();
  }

  return 'FLAVOR_' + result;
}

/**
 * Tool that sets custom flavor values for a player using a Lua function
 */
class SetFlavorsTool extends ActionTool<SetFlavorsResultType> {
  /**
   * Unique identifier for the set-flavors tool
   */
  readonly name = "set-flavors";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Set flavor values (0-100, 50 is balanced) and/or grand strategy to shape tactical AI preferences without changing ongoing queues. Only send in values you intend to change.";

  /**
   * Input schema for the set-flavors tool
   */
  inputSchema = z.object({
    PlayerID: z.number().min(0).max(MaxMajorCivs - 1).describe("ID of the player"),
    GrandStrategy: z.string().optional().describe("The grand strategy name to set (and override)"),
    Flavors: z.record(
      z.string(),
      z.number()
    ).optional().describe("Flavor values to set: 0 = forbid, 30 = enough, 50 = balanced, 70 = prioritize, 100 = emergency focus."),
    Rationale: z.string().describe("Briefly explain your rationale for these adjustments")
  }).extend(sourceTurnField);

  /**
   * Result schema - returns previous grand strategy and flavor values
   */
  protected resultSchema = SetFlavorsResultSchema;

  /**
   * The Lua function arguments
   */
  protected arguments = ["playerID", "flavors", "grandId"];

  /**
   * The Lua script to execute
   */
  protected script = `
    local activePlayer = Players[playerID]
    local changed = false

    -- Capture previous grand strategy
    local previousGrandStrategy = activePlayer:GetGrandStrategy()

    -- Get ALL current custom flavors using GetCustomFlavors
    local previousFlavors = activePlayer:GetCustomFlavors()

    -- Set grand strategy if provided
    if grandId ~= -1 then
      if activePlayer:SetGrandStrategy(grandId) then
        changed = true
      end
    end

    -- Set custom flavors if provided
    if flavors then
      if activePlayer:SetCustomFlavors(flavors) then
        changed = true
      end
    end

    -- Return the previous values
    return {
      Changed = changed,
      GrandStrategy = previousGrandStrategy,
      Flavors = previousFlavors
    }
  `;

  /**
   * Execute the set-flavors command
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    // Trim rationale and extract source turn
    const { Rationale: rawRationale, Turn: _sourceTurn, ...otherArgs } = args;
    const Rationale = this.trimRationale(rawRationale);
    const turn = this.resolveSourceTurn(args);

    // Load valid flavor keys from JSON
    const validFlavors = await loadFlavorDescriptions();
    const validFlavorKeys = Object.keys(validFlavors);

    // Convert PascalCase keys to FLAVOR_ format if flavors are provided
    // Only include flavors that exist in the JSON file
    // Clamp values to MCP range (0-100) - CvFlavorManager handles conversion to game range
    const flavorsTable: Record<string, number> = {};
    const newFlavors: Record<string, number> = {};
    if (otherArgs.Flavors) {
      for (const [key, value] of Object.entries(otherArgs.Flavors)) {
        if (validFlavorKeys.includes(key)) {
          // Clamp to MCP range (0-100)
          const clampedMcpValue = Math.max(0, Math.min(100, value));

          flavorsTable[convertToFlavorFormat(key)] = clampedMcpValue;
          newFlavors[key] = clampedMcpValue;
        }
      }
    }

    // Call the parent execute with the converted flavors and grand strategy
    const grandStrategyId = retrieveEnumValue("GrandStrategy", otherArgs.GrandStrategy)
    const result = await super.call(otherArgs.PlayerID, flavorsTable, grandStrategyId);

    if (result.Success) {
      const store = this.getStore();
      const previous = result.Result!;

      // Build the complete flavor state to store
      const flavorChange: Partial<Insertable<FlavorChange>> = {
        Rationale: Rationale
      };

      // GetCustomFlavors now returns MCP range (0-100) directly
      const currentFlavors: Record<string, number> = {};
      for (const [key, value] of Object.entries(previous.Flavors)) {
        // Use pascalCase from change-case for consistency
        const withoutPrefix = key.replace(/^FLAVOR_/, '');
        const pascalKey = pascalCase(withoutPrefix);
        currentFlavors[pascalKey] = value as number; // Already in MCP range
      }

      const changeDescriptions: string[] = [];
      // Add grand strategy change if provided
      const previousGrandStrategy = retrieveEnumName("GrandStrategy", previous.GrandStrategy);
      if (otherArgs.GrandStrategy && previousGrandStrategy !== otherArgs.GrandStrategy) {
        changeDescriptions.push(`Grand Strategy: ${previousGrandStrategy} → ${otherArgs.GrandStrategy}`);
      }
      flavorChange.GrandStrategy = otherArgs.GrandStrategy ? retrieveEnumName("GrandStrategy", grandStrategyId) : previousGrandStrategy;

      // Compare values and apply the new flavors
      for (const [key, value] of Object.entries(newFlavors)) {
        const beforeValue = currentFlavors?.[key];
        if (beforeValue !== undefined && beforeValue !== value) {
          changeDescriptions.push(`${key}: ${beforeValue} → ${value}`);
        }
      }
      Object.assign(currentFlavors, newFlavors);

      // Store ALL flavors (both existing and new) in the knowledge store
      for (const key of validFlavorKeys) {
        (flavorChange as Record<string, unknown>)[key] = currentFlavors[key] ?? 50;
      }

      // Store in the database
      await store.storeMutableKnowledge(
        'FlavorChanges',
        otherArgs.PlayerID,
        flavorChange,
        composeVisibility([otherArgs.PlayerID]),
        undefined,
        turn
      );

      // Compare and send action event + replay message for actual changes
      const summary = changeDescriptions.length > 0 ? changeDescriptions.join("; ") : "No changes";
      await this.pushAction(otherArgs.PlayerID, "flavors", summary, Rationale, changeDescriptions.length > 0 ? "AI preferences" : undefined, turn);
    }

    delete result.Result;
    return result;
  }
}

/**
 * Creates a new instance of the set flavors tool
 */
export default function createSetFlavorsTool() {
  return new SetFlavorsTool();
}