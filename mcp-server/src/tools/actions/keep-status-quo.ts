/**
 * Tool for recording the decision to maintain current strategic direction
 */

import { ActionTool, sourceTurnField } from "../abstract/action.js";
import * as z from "zod";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { loadFlavorDescriptions } from "../../utils/strategies/loader.js";

/**
 * Mode enum for keep-status-quo tool
 */
const ModeEnum = z.enum(["Flavor", "Strategy"]).default("Strategy");

/**
 * Tool that refreshes the current strategies/flavors and records the decision to keep the status quo
 */
class KeepStatusQuoTool extends ActionTool<boolean> {
  /**
   * Unique identifier for the keep-status-quo tool
   */
  readonly name = "keep-status-quo";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Maintain the current in-game strategy and document the rationale";

  /**
   * Input schema for the keep-status-quo tool
   */
  readonly inputSchema = z.object({
    PlayerID: z.number().min(0).max(MaxMajorCivs - 1).describe("ID of the player"),
    Mode: ModeEnum.describe("'Flavor' to reapply custom flavors, 'Strategy' to reapply strategies (default)"),
    Rationale: z.string().optional().describe("Briefly explain why the current strategic direction should be maintained")
  }).extend(sourceTurnField);

  /**
   * Result schema - always true unless execution failed
   */
  protected resultSchema = z.boolean();

  /**
   * The Lua function arguments
   */
  protected arguments = ["playerID", "mode"];

  /**
   * Optional metadata
   */
  readonly metadata = {
    autoComplete: ["PlayerID", "Turn", "Mode"]
  }

  /**
   * The Lua script to execute - refreshes current strategies or flavors by reading and re-applying them
   */
  protected script = `
    local activePlayer = Players[playerID]

    local currentGrand = activePlayer:GetGrandStrategy()
    activePlayer:SetGrandStrategy(currentGrand)

    if mode == "Flavor" then
      -- Get current custom flavors
      local currentFlavors = activePlayer:GetCustomFlavors()

      -- Re-apply the same custom flavors to refresh them
      activePlayer:SetCustomFlavors(currentFlavors)
    else
      -- Get current strategies
      local currentEconomic = activePlayer:GetEconomicStrategies()
      local currentMilitary = activePlayer:GetMilitaryStrategies()

      -- Re-apply the same strategies to refresh them
      activePlayer:SetEconomicStrategies(currentEconomic)
      activePlayer:SetMilitaryStrategies(currentMilitary)
    end

    return true
  `;

  /**
   * Execute the keep-status-quo command
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    // Trim rationale
    const { Rationale: rawRationale, Turn: _sourceTurn, ...otherArgs } = args;
    const Rationale = rawRationale === undefined ? undefined : this.trimRationale(rawRationale);
    const turn = this.resolveSourceTurn(args);

    // Call the Lua function to refresh strategies or flavors
    const result = await super.call(otherArgs.PlayerID, otherArgs.Mode);

    if (result.Success) {
      // Pacing skips call this without a rationale: refresh the in-game AI
      // settings, but do not create a recorded strategic decision.
      if (Rationale === undefined) return result;

      const store = this.getStore();

      if (otherArgs.Mode === "Flavor") {
        // Get the current flavors from the knowledge store
        const previous = await store.getMutableKnowledge("FlavorChanges", otherArgs.PlayerID);

        if (previous) {
          // Load valid flavor keys
          const validFlavors = await loadFlavorDescriptions();
          const validFlavorKeys = Object.keys(validFlavors);

          // Extract only flavor columns and metadata
          const flavorData: Record<string, any> = {
            GrandStrategy: previous.GrandStrategy,
            Rationale: Rationale
          };

          // Copy only the flavor columns
          for (const key of validFlavorKeys) {
            if (key in previous) {
              flavorData[key] = previous[key as keyof typeof previous];
            }
          }

          // Store the flavors with the rationale
          await store.storeMutableKnowledge(
            'FlavorChanges',
            otherArgs.PlayerID,
            flavorData,
            undefined,
            undefined,
            turn
          );
        }
      } else {
        // Get the current strategies from the knowledge store
        const previous = await store.getMutableKnowledge("StrategyChanges", otherArgs.PlayerID);

        // Store the strategy (always) with the rationale
        await store.storeMutableKnowledge(
          'StrategyChanges',
          otherArgs.PlayerID,
          {
            GrandStrategy: previous?.GrandStrategy,
            MilitaryStrategies: previous?.MilitaryStrategies ?? [],
            EconomicStrategies: previous?.EconomicStrategies ?? [],
            Rationale: Rationale
          },
          undefined,
          undefined,
          turn
        );
      }

      // Fire action event (no replay message for status-quo)
      await this.pushAction(otherArgs.PlayerID, "status-quo", `Maintaining ${otherArgs.Mode}`, Rationale, undefined, turn);
    }

    return result;
  }
}

/**
 * Creates a new instance of the keep status quo tool
 */
export default function createKeepStatusQuoTool() {
  return new KeepStatusQuoTool();
}
