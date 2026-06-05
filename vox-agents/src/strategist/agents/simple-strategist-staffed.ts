/**
 * @module strategist/simple-strategist-staffed
 *
 * Staffed strategist agent implementation.
 * Uses multiple specialized briefer agents running in parallel to provide
 * comprehensive Military, Economy, and Diplomacy briefings before making strategic decisions.
 */

import { ModelMessage } from "ai";
import { SimpleStrategistBase } from "./simple-strategist-base.js";
import { VoxContext } from "../../infra/vox-context.js";
import { getDecisionTurnContext, getRecentGameState, StrategistParameters } from "../strategy-parameters.js";
import { jsonToMarkdown } from "../../utils/tools/json-to-markdown.js";
import { requestBriefing, assembleBriefings, briefingInstructionKeys } from "../../briefer/briefing-utils.js";
import { getStrategicPlayersReport } from "../../utils/prompts/report-filters.js";

/**
 * A staffed strategist agent that uses specialized briefers for comprehensive analysis.
 * Delegates game state analysis to three specialized briefers (Military, Economy, Diplomacy)
 * running in parallel to provide focused, multi-dimensional strategic insight.
 *
 * @class
 */
export class SimpleStrategistStaffed extends SimpleStrategistBase {
  /**
   * The name identifier for this agent
   */
  readonly name = "simple-strategist-staffed";

  readonly displayName = "Staffed LLM Strategist";

  /**
   * Human-readable description of what this agent does
   */
  readonly description = "Uses specialized briefers (Military, Economy, Diplomacy) running in parallel to provide comprehensive multi-dimensional strategic analysis";

  /**
   * Gets the system prompt for the strategist
   */
  public async getSystem(parameters: StrategistParameters, _context: VoxContext<StrategistParameters>): Promise<string> {
    return `
${SimpleStrategistBase.expertPlayerPrompt}

${SimpleStrategistBase.expectationPrompt}

${SimpleStrategistBase.goalsPrompt}
${SimpleStrategistBase.specializedBrieferGoalPrompt}
${SimpleStrategistBase.brieferCapabilitiesPrompt}
${SimpleStrategistBase.getDecisionPrompt(parameters.mode)}

# Resources
You will receive the following reports:
${SimpleStrategistBase.optionsDescriptionPrompt}
${SimpleStrategistBase.strategiesDescriptionPrompt}
${SimpleStrategistBase.victoryConditionsPrompt}
${SimpleStrategistBase.playersInfoPrompt}
${SimpleStrategistBase.briefingsResourcePrompt}`.trim()
  }

  /**
   * Gets the initial messages for the conversation
   */
  public async getInitialMessages(parameters: StrategistParameters, input: unknown, context: VoxContext<StrategistParameters>): Promise<ModelMessage[]> {
    var state = getRecentGameState(parameters)!;
    let briefingsContent: string;
    const militaryInstruction = parameters.workingMemory[briefingInstructionKeys.Military];
    const economyInstruction = parameters.workingMemory[briefingInstructionKeys.Economy];
    const diplomacyInstruction = parameters.workingMemory[briefingInstructionKeys.Diplomacy];

    // Check the event length to decide between simple/specialized briefer
    if (JSON.stringify(state.events!).length <= 5000 || state.turn <= 1) {
      // Assemble combined instruction from specialized instructions and store for simple-briefer
      parameters.workingMemory[briefingInstructionKeys.combined] = [
        `- Military: ${militaryInstruction ?? "a general report."}`,
        `- Economy: ${economyInstruction ?? "a general report."}`,
        `- Diplomacy: ${diplomacyInstruction ?? "a general report."}`
      ].join("\n\n");

      // Use simple-briefer for fewer events (requestBriefing reads instruction from workingMemory)
      const briefing = await requestBriefing("combined", state, context, parameters);

      if (!briefing) {
        throw new Error("Failed to generate strategic briefing.");
      }

      briefingsContent = assembleBriefings(briefing, parameters.workingMemory[briefingInstructionKeys.combined] || undefined);
    } else {
      // Use specialized briefers for more complex situations (requestBriefing reads instructions from workingMemory)
      const [militaryBriefing, economyBriefing, diplomacyBriefing] = await Promise.all([
        requestBriefing("Military", state, context, parameters),
        requestBriefing("Economy", state, context, parameters),
        requestBriefing("Diplomacy", state, context, parameters),
      ]);

      if (!militaryBriefing || !economyBriefing || !diplomacyBriefing) {
        throw new Error("Failed to generate strategic briefings.");
      }

      // Compile briefings with any instructions provided
      briefingsContent = assembleBriefings([
        { title: "Military Briefing", content: militaryBriefing, instruction: militaryInstruction },
        { title: "Economy Briefing", content: economyBriefing, instruction: economyInstruction },
        { title: "Diplomacy Briefing", content: diplomacyBriefing, instruction: diplomacyInstruction }
      ]);
    }

    // Clear the instructions from working memory
    delete parameters.workingMemory[briefingInstructionKeys.Military];
    delete parameters.workingMemory[briefingInstructionKeys.Economy];
    delete parameters.workingMemory[briefingInstructionKeys.Diplomacy];
    delete parameters.workingMemory[briefingInstructionKeys.combined];

    // Get the information
    await super.getInitialMessages(parameters, input, context);
    const { YouAre, ...SituationData } = parameters.metadata || {};
    const { Options, ...Strategy } = state.options || {};

    // Save the assembled briefings for spokesperson use
    state.reports["briefing"] = briefingsContent;

    // Return the messages with all briefings
    return [{
      role: "system",
      content: `
You are ${parameters.metadata?.YouAre!.Leader}, leader of ${parameters.metadata?.YouAre!.Name} (Player ${parameters.playerID ?? 0}).

# Situation
${jsonToMarkdown(SituationData)}

# Your Civilization
${jsonToMarkdown(YouAre)}

# Options
Options: available strategic options for you.

${jsonToMarkdown(Options, {
  configs: [{}]
})}`.trim(),
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } }
      }
    }, {
      role: "user",
      content: `
# Strategies
Strategies: existing strategic decisions from you.

${jsonToMarkdown(Strategy)}

# Players
Players: summary reports about visible players in the world.

${jsonToMarkdown(getStrategicPlayersReport(state.players!))}

# Victory Progress
Victory Progress: current progress towards each type of victory.

${jsonToMarkdown(state.victory)}

# Briefings
${briefingsContent}

${getDecisionTurnContext(parameters)}
`.trim()
    }];
  }

  /**
   * Gets the list of active tools for this agent
   */
  public getActiveTools(parameters: StrategistParameters): string[] | undefined {
    // Return specific tools the strategist needs
    return ["focus-briefer", ...(super.getActiveTools(parameters) ?? [])]
  }
}
