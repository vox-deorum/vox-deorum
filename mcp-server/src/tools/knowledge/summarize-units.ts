import { LuaFunctionTool } from "../abstract/lua-function.js";
import * as z from "zod";
import { enumMappings } from "../../knowledge/helpers/enum.js";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("summarize-units");
/**
 * Schema for military unit info
 */
const MilitaryUnitSchema = z.object({
  Strength: z.number().optional(),
  RangedStrength: z.number().optional(),
  Count: z.number()
});

/**
 * Schema for unit overview result
 */
const UnitOverviewResultSchema = z.record(
  z.string(), // Civilization name
  z.record(z.string(), // AI type
    z.record(z.string(), z.union([z.number(), MilitaryUnitSchema]))) // Unit name -> count or military unit info
);

/**
 * Type for the unit overview result schema
 */
type UnitOverviewResultType = z.infer<typeof UnitOverviewResultSchema>;

/**
 * Tool for getting an overview of all visible units for a given player
 * Groups units by civilization owner and AI type
 * Military units include Strength, RangedStrength, and Count
 * Non-military units have simple counts
 */
class SummarizeUnitsTool extends LuaFunctionTool<UnitOverviewResultType> {
  /**
   * Unique identifier for the summarize units tool
   */
  readonly name = "summarize-units";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Gets an overview of all visible units for a player, grouped by civilization and AI type";

  /**
   * Schema for validating tool inputs
   */
  readonly inputSchema = z.object({
    PlayerID: z.number().describe("The player ID to get unit visibility for")
  });

  /**
   * Schema for the result data
   */
  protected readonly resultSchema = UnitOverviewResultSchema;

  /**
   * Lua function arguments
   */
  protected readonly arguments = ["playerID"];

  /**
   * Path to the Lua script file
   */
  protected readonly scriptFile = "summarize-units.lua";

  /**
   * Optional annotations for the tool
   */
  readonly annotations: ToolAnnotations = {
    readOnlyHint: true
  }

  /**
   * Optional metadata for the tool
   */
  readonly metadata = {
    autoComplete: ["PlayerID"],
    markdownConfig: ["{key}", "{key} Units", "{key}"]
  }
  
  /**
   * Execute the tool with the provided arguments
   */
  async execute(args: z.infer<typeof this.inputSchema>) {
    const result = await this.call(args.PlayerID);

    if (!result.Success) {
      throw new Error(`Failed to get unit overview: ${result.Error?.Message || 'Unknown error'}`);
    }

    // Convert numeric AI type enums and unit type keys to their string representations
    if (result.Result) {
      const unitTypes = enumMappings["UnitType"];
      const aiTypes = enumMappings["AIType"];
      if (!unitTypes) logger.warn("UnitType does not exist!");
      if (!aiTypes) logger.warn("AIType does not exist!");

      for (const civName in result.Result) {
        const unitsByAIType: Record<string, Record<string, number | z.infer<typeof MilitaryUnitSchema>>> = result.Result[civName];
        const convertedAITypes: Record<string, Record<string, number | z.infer<typeof MilitaryUnitSchema>>> = {};

        for (const [aiTypeNum, units] of Object.entries(unitsByAIType)) {
          // Convert the AI type enum to string
          const aiType = aiTypes?.[Number(aiTypeNum)] ?? `Unknown_${aiTypeNum}`;

          // Convert unit type keys to their string representations
          const convertedUnitTypes: Record<string, number | z.infer<typeof MilitaryUnitSchema>> = {};
          for (const [unitTypeNum, unitData] of Object.entries(units as Record<string, number | z.infer<typeof MilitaryUnitSchema>>)) {
            const unitType = unitTypes?.[Number(unitTypeNum)] ?? `Unknown_${unitTypeNum}`;
            convertedUnitTypes[unitType] = unitData;
          }

          convertedAITypes[aiType] = convertedUnitTypes;
        }

        result.Result[civName] = convertedAITypes;
      }
    }

    return {
      Success: true,
      Result: result.Result
    }
  }
}

/**
 * Creates a new instance of the summarize units tool.
 */
export default function createSummarizeUnitsTool() {
  return new SummarizeUnitsTool();
}