/**
 * Tool for setting the active player's grand strategy in Civilization V
 */

import { ActionTool, sourceTurnField } from "../abstract/action.js";
import * as z from "zod";
import { retrieveEnumValue, convertStrategyToNames } from "../../knowledge/helpers/enum.js";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { composeVisibility } from "../../knowledge/helpers/visibility.js";
import { detectChanges } from "../../knowledge/helpers/changes.js";

/**
 * Schema for the result returned by the Lua script
 */
const SetStrategyResultSchema = z.object({
  Changed: z.boolean(),
  GrandStrategy: z.number(),
  EconomicStrategies: z.union([z.array(z.number()), z.record(z.string(), z.number())]),
  MilitaryStrategies: z.union([z.array(z.number()), z.record(z.string(), z.number())])
});

type SetStrategyResultType = z.infer<typeof SetStrategyResultSchema>;

/**
 * Tool that sets the player's grand strategy using a Lua function
 */
class SetStrategyTool extends ActionTool<SetStrategyResultType> {
  /**
   * Unique identifier for the set-strategy tool
   */
  readonly name = "set-strategy";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Set a player's in-game strategy by names. Inputs must match exact values in the provided options.";

  /**
   * Input schema for the set-strategy tool
   */
  inputSchema = z.object({
    PlayerID: z.number().min(0).max(MaxMajorCivs - 1).describe("ID of the player"),
    GrandStrategy: z.string().optional().describe("The grand strategy name to set (and override)"),
    EconomicStrategies: z.array(z.string()).optional().describe("The economic strategy names to set (and override)"),
    MilitaryStrategies: z.array(z.string()).optional().describe("The military strategy names to set (and override)"),
    Rationale: z.string().describe("Briefly explain your rationale behind choosing this strategy set")
  }).extend(sourceTurnField);

  /**
   * Result schema - returns strategy change information
   */
  protected resultSchema = SetStrategyResultSchema;

  /**
   * The Lua function arguments
   */
  protected arguments = ["playerID", "grandId", "economicIds", "militaryIds"];

  /**
   * The Lua script to execute
   */
  protected script = `
    local activePlayer = Players[playerID]

    -- Capture previous strategies before setting new ones
    local previousGrand = activePlayer:GetGrandStrategy()
    local previousEconomic = activePlayer:GetEconomicStrategies()
    local previousMilitary = activePlayer:GetMilitaryStrategies()

    -- Set new strategies
    local changed = false
    if grandId ~= -1 then
      if activePlayer:SetGrandStrategy(grandId) then
        changed = true
      end
    end
    if economicIds ~= nil then
      if activePlayer:SetEconomicStrategies(economicIds) then
        changed = true
      end
    end
    if militaryIds ~= nil then
      if activePlayer:SetMilitaryStrategies(militaryIds) then
        changed = true
      end
    end

    -- Return success and previous strategies
    return {
      Changed = changed,
      GrandStrategy = previousGrand,
      EconomicStrategies = previousEconomic,
      MilitaryStrategies = previousMilitary
    }
  `;

  /**
   * Execute the set-strategy command
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    // Resolve turn and trim rationale
    const { Rationale: rawRationale, Turn: _sourceTurn, ...otherArgs } = args;
    const Rationale = this.trimRationale(rawRationale);
    const turn = this.resolveSourceTurn(args);

    // Find the strategy ID from the string name
    const grandStrategyId = retrieveEnumValue("GrandStrategy", otherArgs.GrandStrategy)
    const economicStrategyIds = otherArgs.EconomicStrategies?.
      map(s => retrieveEnumValue("EconomicStrategy", s)).filter(s => s !== -1);
    const militaryStrategyIds = otherArgs.MilitaryStrategies?.
      map(s => retrieveEnumValue("MilitaryStrategy", s)).filter(s => s !== -1);

    // Call the parent execute with the strategy ID
    const result = await super.call(otherArgs.PlayerID, grandStrategyId, economicStrategyIds, militaryStrategyIds);
    if (result.Success) {
      const store = this.getStore();
      const lastRationale = (await store.getMutableKnowledge("StrategyChanges", otherArgs.PlayerID))?.Rationale ?? "Unknown";

      // Store the previous strategy with reason "Tweaked by In-Game AI"
      const previous = result.Result!;
      // Postprocessing - handle both array and object formats from Lua
      const economicStrategies = Array.isArray(previous.EconomicStrategies)
        ? previous.EconomicStrategies
        : Object.keys(previous.EconomicStrategies).length === 0 ? [] : Object.values(previous.EconomicStrategies);
      const militaryStrategies = Array.isArray(previous.MilitaryStrategies)
        ? previous.MilitaryStrategies
        : Object.keys(previous.MilitaryStrategies).length === 0 ? [] : Object.values(previous.MilitaryStrategies);

      const normalizedPrevious = {
        GrandStrategy: previous.GrandStrategy,
        EconomicStrategies: economicStrategies,
        MilitaryStrategies: militaryStrategies
      };

      // Store the strategy
      const before = convertStrategyToNames(normalizedPrevious);
      await store.storeMutableKnowledge(
        'StrategyChanges',
        otherArgs.PlayerID,
        {
          GrandStrategy: before.GrandStrategy,
          EconomicStrategies: before.EconomicStrategies,
          MilitaryStrategies: before.MilitaryStrategies,
          Rationale: lastRationale.startsWith("Tweaked by In-Game AI") ? lastRationale : `Tweaked by In-Game AI(${lastRationale.trim()})`
        },
        composeVisibility([otherArgs.PlayerID]),
        ["Rationale"], // Only ignore Rationale when checking for changes
        turn
      );

      // Convert the numeric values back to string names for the response
      const after = convertStrategyToNames({
        GrandStrategy: grandStrategyId === -1 ? normalizedPrevious.GrandStrategy : grandStrategyId,
        EconomicStrategies: economicStrategyIds ?? economicStrategies,
        MilitaryStrategies: militaryStrategyIds ?? militaryStrategies,
      });

      // Store the new strategy change in the database
      await store.storeMutableKnowledge(
        'StrategyChanges',
        otherArgs.PlayerID,
        {
          ...after,
          Rationale: Rationale
        },
        composeVisibility([otherArgs.PlayerID]),
        undefined,
        turn
      );

      // Compare and send replay messages
      const changedFields = detectChanges(before, after, ["Rationale"]);
      if (changedFields.length > 0) {
        // Build detailed change descriptions
        const changeDescriptions = changedFields.map(field => {
          const beforeValue = before[field as keyof typeof before];
          const afterValue = after[field as keyof typeof after];

          if (Array.isArray(beforeValue) && Array.isArray(afterValue)) {
            // For array fields (strategies)
            return `${field}: [${beforeValue.join(", ") || "None"}] → [${afterValue.join(", ") || "None"}]`;
          } else {
            // For single value fields
            return `${field}: ${beforeValue || "None"} → ${afterValue || "None"}`;
          }
        });

        const summary = changeDescriptions.join("; ");
        await this.pushAction(otherArgs.PlayerID, "strategy", summary, Rationale, "Strategies", turn);
      }
    }

    delete result.Result;
    return result;
  }
}

/**
 * Creates a new instance of the set strategy tool
 */
export default function createSetStrategyTool() {
  return new SetStrategyTool();
}