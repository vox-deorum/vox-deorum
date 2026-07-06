/**
 * @module strategist/simple-strategist-briefed
 *
 * Briefed strategist agent implementation.
 * Uses a briefer agent to summarize game state before making strategic decisions,
 * reducing context size and focusing on key strategic insights.
 */

import { ModelMessage } from "ai";
import { SimpleStrategistBase } from "./simple-strategist-base.js";
import { VoxContext } from "../../infra/vox-context.js";
import { getDecisionTurnContext, getRecentGameState, StrategistParameters } from "../strategy-parameters.js";
import { jsonToMarkdown } from "../../utils/tools/json-to-markdown.js";
import { requestBriefing, assembleBriefings, buildCombinedInstruction, clearBrieferInstructions } from "../../briefer/briefing-utils.js";
import { getStrategicPlayersReport } from "../../utils/prompts/report-filters.js";

/**
 * A briefed strategist agent that first requests a briefing before making strategic decisions.
 * Delegates game state summarization to a briefer agent to focus on high-level strategy.
 *
 * @class
 */
export class SimpleStrategistBriefed extends SimpleStrategistBase {
  /**
   * The name identifier for this agent
   */
  readonly name = "simple-strategist-briefed";

  readonly displayName = "Briefed LLM Strategist";

  /**
   * Human-readable description of what this agent does
   */
  readonly description = "Requests a strategic briefing before making decisions, using summarized game state for focused high-level strategy";

  /**
   * Gets the system prompt for the strategist
   */
  public async getSystem(parameters: StrategistParameters, _context: VoxContext<StrategistParameters>): Promise<string> {
    return `
${SimpleStrategistBase.expertPlayerPrompt}

${SimpleStrategistBase.expectationPrompt}

${SimpleStrategistBase.goalsPrompt}
- You can ask your briefer to prepare a focused report (only for) the next turn by calling the \`focus-briefer\` tool.
  - Only ask for information relevant to the macro-level decisions in your control.
${SimpleStrategistBase.brieferCapabilitiesPrompt}
${SimpleStrategistBase.getDecisionPrompt(parameters.mode)}

# Resources
You will receive the following reports:
${SimpleStrategistBase.optionsDescriptionPrompt}
${SimpleStrategistBase.strategiesDescriptionPrompt}
${SimpleStrategistBase.victoryConditionsPrompt}
${SimpleStrategistBase.playersInfoPrompt}
- Briefing: prepared by your briefer, summarizing the current game situation.
  - You will make independent and wise judgment.`.trim()
  }

  /**
   * Gets the initial messages for the conversation
   */
  public async getInitialMessages(parameters: StrategistParameters, input: unknown, context: VoxContext<StrategistParameters>): Promise<ModelMessage[]> {
    var state = getRecentGameState(parameters)!;
    // Fold the focus-briefer instructions into one for the combined briefer
    const instruction = buildCombinedInstruction(parameters);

    // Get the briefing via requestBriefing (reads instruction from workingMemory, deduplicates concurrent calls)
    const briefing = await requestBriefing("combined", state, context, parameters);
    clearBrieferInstructions(parameters);
    if (!briefing) throw new Error("Failed to generate strategic briefings.");

    // Get the information
    await super.getInitialMessages(parameters, input, context);
    const { YouAre, ...SituationData } = parameters.metadata || {};
    const { Options, ...Strategy } = state.options || {};
    const filteredPlayers = getStrategicPlayersReport(state.players!);

    // Return the messages with briefing instead of full state
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

${jsonToMarkdown(Options, { configs: [{}] })}`.trim(),
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

${jsonToMarkdown(filteredPlayers)}

# Victory Progress
Victory Progress: current progress towards each type of victory.

${jsonToMarkdown(state.victory)}

# Briefings
${assembleBriefings(briefing, instruction)}

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
