/**
 * Tool for retrieving player strategic options from the game
 * Returns available technologies, policies, and strategies for a specific player
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { getPlayerOptions } from "../../knowledge/getters/player-options.js";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { stripTimedKnowledgeMetadata } from "../../utils/knowledge/strip-metadata.js";
import { PlayerOptions } from "../../knowledge/schema/timed.js";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { readPlayerKnowledge } from "../../utils/knowledge/cached.js";
import { getPlayerStrategy } from "../../knowledge/getters/player-strategy.js";
import { getPlayerPersona } from "../../knowledge/getters/player-persona.js";
import { getPlayerFlavors } from "../../knowledge/getters/player-flavors.js";
import { getPlayerRelationships } from "../../knowledge/getters/player-relationships.js";
import { enumMappings } from "../../utils/knowledge/enum.js";
import { getTool } from "../index.js";
import { formatPolicyHelp } from "../../utils/database/format.js";
import { loadGrandStrategyDescriptions, loadFlavorDescriptions } from "../../utils/strategies/loader.js";

/**
 * Input schema for the GetOptions tool
 */
const GetOptionsInputSchema = z.object({
  PlayerID: z.number().min(0).max(MaxMajorCivs - 1).describe("Player ID to retrieve strategic options for"),
  Mode: z.enum(["Flavor", "Strategy"]).optional().default("Strategy").describe("Mode for retrieving options - 'Flavor' for tactical AI preferences, 'Strategy' for high-level strategies")
});

/**
 * Output schema for the GetOptions tool
 */
const GetOptionsOutputSchema = z.object({
  // Options - available choices
  Options: z.object({
    GrandStrategies: z.any(),
    MilitaryStrategies: z.any().optional(),
    EconomicStrategies: z.any().optional(),
    Flavors: z.any().optional(),
    Technologies: z.any(),
    Policies: z.any()
  }),
  // Persona fields
  Persona: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  // Strategy - current selections and rationale
  Strategy: z.object({
    Rationale: z.string().optional(),
    GrandStrategy: z.string().optional(),
    // Strategies - only in Strategy mode
    EconomicStrategies: z.array(z.string()).optional(),
    MilitaryStrategies: z.array(z.string()).optional(),
    // Flavors - current custom flavor values (only in Flavor mode)
    Flavors: z.record(z.string(), z.number()).optional(),
  }),
  // Technology - current selection
  Technology: z.object({
    Next: z.string(),
    Rationale: z.string().optional()
  }),
  // Policy - current selection
  Policy: z.object({
    Next: z.string(),
    Rationale: z.string().optional()
  }),
  // Relationships - diplomatic relationship modifiers set by the player
  Relationships: z.record(z.string(), z.object({
    Public: z.number().describe("Public relationship modifier - visible diplomatic stance"),
    Private: z.number().describe("Private relationship modifier - hidden feelings/attitudes"),
    Rationale: z.string().describe("Explanation for the relationship change"),
    UpdatedTurn: z.number().describe("Turn when the relationship was last updated")
  })).optional().describe("Diplomatic relationship modifiers by civilization name")
}).passthrough();

/**
 * Type for the tool's output.
 */
export type OptionsReport = z.infer<typeof GetOptionsOutputSchema>;

/**
 * Tool for retrieving player strategic options
 */
class GetOptionsTool extends ToolBase {
  /**
   * Unique identifier for the tool
   */
  readonly name = "get-options";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Retrieves available strategic options (technologies, policies, strategies) for a specific player";

  /**
   * Input schema for the tool
   */
  readonly inputSchema = GetOptionsInputSchema;

  /**
   * Output schema for the tool
   */
  readonly outputSchema = GetOptionsOutputSchema;

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
    autoComplete: ["PlayerID", "Mode"],
    markdownConfig: ["{key}", "{key}", "{key}"]
  }

  /**
   * Execute the tool to retrieve player options
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    const isFlavorMode = args.Mode === "Flavor";

    const [
      allOptions,
      persona,
      technologies,
      policies,
      grandStrategyDescriptions,
      research,
      policy,
      strategies,
      economicStrategies,
      militaryStrategies,
      flavors,
      flavorDescriptions,
      relationships
    ] = await Promise.all([
      getPlayerOptions(true),
      readPlayerKnowledge(args.PlayerID, "PersonaChanges", getPlayerPersona),
      getTool("getTechnology")?.getSummaries(),
      getTool("getPolicy")?.getSummaries(),
      loadGrandStrategyDescriptions(args.Mode),
      readPlayerKnowledge(args.PlayerID, "ResearchChanges", async () => {
        return { Technology: "None", Rationale: undefined }
      }),
      readPlayerKnowledge(args.PlayerID, "PolicyChanges", async () => {
        return { Policy: "None", IsBranch: 0, Rationale: undefined }
      }),
      isFlavorMode ? null : readPlayerKnowledge(args.PlayerID, "StrategyChanges", getPlayerStrategy),
      isFlavorMode ? null : getTool("getEconomicStrategy")?.getSummaries(),
      isFlavorMode ? null : getTool("getMilitaryStrategy")?.getSummaries(),
      !isFlavorMode ? null : readPlayerKnowledge(args.PlayerID, "FlavorChanges", getPlayerFlavors),
      !isFlavorMode ? null : loadFlavorDescriptions(),
      getPlayerRelationships(args.PlayerID)
    ]);

    // Find options for the requested player
    if (!Array.isArray(allOptions)) {
      throw new Error(`Failed to fetch player options.`);
    }
    const playerOptions = allOptions.find((options) => options.PlayerID === args.PlayerID);
    if (!playerOptions)
      throw new Error(`No options found for player ${args.PlayerID}. Player may not be alive or does not exist.`);

    // If the research has been done, remove the rationale
    if (research) {
      if (playerOptions.NextResearch === "None" || research.Technology === "None") {
        delete research.Rationale;
        research.Technology = "None";
      }
    }
    if (policy) {
      if ((playerOptions.NextPolicy === "None" && playerOptions.NextBranch === "None") || policy.Policy == "None") {
        delete policy.Rationale;
        policy.Policy = "None";
      }
    }

    // Strip metadata from the options
    const cleanOptions = stripTimedKnowledgeMetadata<PlayerOptions>(playerOptions);

    // Build Options object based on mode
    // Built incrementally based on mode; fields added in mode-specific branches below
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- incrementally constructed with mode-specific fields
    const optionsObject: any = {
      GrandStrategies: Object.fromEntries(
        Object.values(enumMappings["GrandStrategy"])
          .filter(s => s !== "None")
          .map(strategyName => [
            strategyName,
            grandStrategyDescriptions?.[strategyName] ?? strategyName
          ])
      ),
      Flavors: undefined,
      Strategies: undefined,
      Technologies: technologies && Array.isArray(technologies) && cleanOptions.Technologies.length > 0 ?
        Object.fromEntries(
          cleanOptions.Technologies.map(techName => {
            const tech = technologies.find((s) => s.Name === techName);
            let help = tech?.Help ?? "";
            if ((tech?.TechsUnlocked?.length ?? 0) > 0)
              help += `\nCompleting it would unlock: ${tech?.TechsUnlocked?.join(", ")}`;
            return [
              techName,
              help.trim()
            ];
          })
        ) : cleanOptions.Technologies,
      Policies: policies && Array.isArray(policies) ?
        Object.fromEntries(
          cleanOptions.Policies.map(policyName => {
            const current = policies.find((s) => s.Name === policyName);
            const Help = formatPolicyHelp(current?.Help ?? "", policyName);
            if (!current?.Branch) throw new Error(`Failed to retrieve the policy branch: ${policyName}`);
            // Add tenet level information for ideology policies
            let displayName = policyName;
            if (current?.Level) {
              displayName += ` (Level ${current.Level} Tenet of Ideology ${current?.Branch})`;
            } else {
              displayName += ` (Continuing ${current?.Branch} Branch)`;
            }
            return [
              displayName,
              Help.length > 1 ? Help : Help[0]
            ];
          }).concat(cleanOptions.PolicyBranches.map(policyName => {
            const current = policies.find((s) => s.Name === policyName);
            const Help = formatPolicyHelp(current?.Help ?? "", policyName);
            return [
              policyName + " (New Branch)",
              Help.length > 1 ? Help : Help[0]
            ];
          }))
        ) : cleanOptions.Policies.concat(cleanOptions.PolicyBranches)
    };

    // Build result object
    // Built incrementally; Strategy added in mode-specific branches below
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- incrementally constructed with mode-specific fields
    const result: any = {
      Persona: persona as Record<string, string | number> | undefined,
      Options: optionsObject,
      Technology: {
        Next: research?.Technology ?? "None",
        Rationale: research?.Rationale
      },
      Policy: {
        // "None" is a cleared selection, not a policy name; frame it plainly as no next policy.
        Next: policy?.Policy && policy.Policy !== "None" ? `${policy.Policy} (${policy.IsBranch ? "New Branch" : "Policy"})` : "None",
        Rationale: policy?.Rationale
      },
      Relationships: Object.keys(relationships).length > 0 ? relationships : undefined
    };

    // Add mode-specific result fields
    if (isFlavorMode) {
      // In Flavor mode: Add current flavors
      const { Key: _Key, Rationale, GrandStrategy, ...flavorValues } = flavors!;
      result.Strategy = {
        Rationale: Rationale,
        GrandStrategy: GrandStrategy,
        Flavors: flavorValues
      };
      optionsObject.Flavors = flavorDescriptions;
    } else {
      // In Strategy mode: Add strategy information
      result.Strategy = {
        Rationale: (strategies as Record<string, unknown> | null)?.Rationale as string | undefined,
        GrandStrategy: strategies?.GrandStrategy,
        EconomicStrategies: strategies?.EconomicStrategies,
        MilitaryStrategies: strategies?.MilitaryStrategies
      };
      optionsObject.EconomicStrategies = Object.fromEntries(
        cleanOptions.EconomicStrategies.map(strategyName => {
          const strategy = economicStrategies!.find((s) => s.Type === strategyName);
          return [
            strategyName,
            strategy?.Description ?? {
              Production: strategy?.Production,
              Overall: strategy?.Overall
            }
          ];
        })
      );
      optionsObject.MilitaryStrategies = Object.fromEntries(
        cleanOptions.MilitaryStrategies.map(strategyName => {
          const strategy = militaryStrategies!.find((s) => s.Type === strategyName);
          return [
            strategyName,
            strategy?.Description ?? {
              Production: strategy?.Production,
              Overall: strategy?.Overall
            }
          ];
        })
      );
    }

    return result;
  }
}

/**
 * Creates a new instance of the get options tool
 */
export default function createGetOptionsTool() {
  return new GetOptionsTool();
}