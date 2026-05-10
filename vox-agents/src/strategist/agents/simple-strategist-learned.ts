/**
 * @module strategist/simple-strategist-learned
 *
 * Learned strategist agent implementation.
 * Extends the staffed strategist with historical episode retrieval capability.
 * The LLM can request similar past game situations via the find-episodes tool,
 * and episodes are integrated into the next turn's context as reference material.
 */

import { ModelMessage, Tool } from "ai";
import { z } from "zod";
import { SimpleStrategistStaffed } from "./simple-strategist-staffed.js";
import { SimpleStrategistBase } from "./simple-strategist-base.js";
import { VoxContext } from "../../infra/vox-context.js";
import { getRecentGameState, StrategistParameters } from "../strategy-parameters.js";
import { requestEpisodes, formatEpisodeResults } from "../../utils/prompts/episode-utils.js";
import { createSimpleTool } from "../../utils/tools/simple-tools.js";

/** Working memory key for storing a pending episode request between turns */
const episodeRequestKey = "episode-request";

/**
 * A learned strategist agent that extends the staffed strategist with historical episode retrieval.
 * The LLM can call the find-episodes tool to search for similar past game situations.
 * Retrieved episodes are integrated into the next turn's context as reference material.
 *
 * @class
 */
export class SimpleStrategistLearned extends SimpleStrategistStaffed {
  /**
   * The name identifier for this agent
   */
  // @ts-expect-error - narrowing parent literal type to a different literal
  override readonly name = "simple-strategist-learned";

  // @ts-expect-error - narrowing parent literal type to a different literal
  override readonly displayName = "Learned LLM Strategist";

  /**
   * Human-readable description of what this agent does
   */
  // @ts-expect-error - narrowing parent literal type to a different literal
  override readonly description = "Staffed strategist with historical episode learning via find-episodes tool";

  /**
   * Gets the system prompt for the strategist
   */
  /**
   * Shared prompt: Episode retrieval tool description
   */
  static readonly episodeGoalPrompt = `- You can steer the retrieval of historical episodes by calling the \`find-episodes\` tool.
  - Describe the situation you want to find episodes for. Episodes will be available NEXT turn.`;

  /**
   * Shared prompt: Historical episodes resource description
   */
  static readonly episodesResourcePrompt = `- Historical Episodes (if available): similar situations from past games with their decisions and outcomes.
  - Use these as reference points to inform your reasoning, not prescriptions. Your situation may differ in important ways.`;

  public async getSystem(parameters: StrategistParameters, _context: VoxContext<StrategistParameters>): Promise<string> {
    return `
${SimpleStrategistBase.expertPlayerPrompt}

${SimpleStrategistBase.expectationPrompt}

${SimpleStrategistBase.goalsPrompt}
${SimpleStrategistBase.specializedBrieferGoalPrompt}
${SimpleStrategistBase.brieferCapabilitiesPrompt}
${SimpleStrategistLearned.episodeGoalPrompt}
${SimpleStrategistBase.getDecisionPrompt(parameters.mode)}

# Resources
You will receive the following reports:
${SimpleStrategistBase.optionsDescriptionPrompt}
${SimpleStrategistBase.strategiesDescriptionPrompt}
${SimpleStrategistBase.victoryConditionsPrompt}
${SimpleStrategistBase.playersInfoPrompt}
${SimpleStrategistBase.briefingsResourcePrompt}
${!!parameters.workingMemory[episodeRequestKey] ? SimpleStrategistLearned.episodesResourcePrompt : ""}`.trim()
  }

  /**
   * Gets the initial messages for the conversation, injecting episodes if requested last turn
   */
  public async getInitialMessages(parameters: StrategistParameters, input: unknown, context: VoxContext<StrategistParameters>): Promise<ModelMessage[]> {
    // Check for a pending episode request from last turn
    let episodesContent: string | undefined;
    const pendingSituation = parameters.workingMemory[episodeRequestKey];
    const state = getRecentGameState(parameters)!;
    const results = await requestEpisodes(state, parameters, pendingSituation);
    if (results.length > 0) {
      episodesContent = formatEpisodeResults(results);
    }
    delete parameters.workingMemory[episodeRequestKey];

    // Get the standard messages from the staffed strategist
    const messages = await super.getInitialMessages(parameters, input, context);

    // Append episodes to the user message if available
    if (episodesContent) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === "user" && typeof lastMessage.content === "string") {
        lastMessage.content += `\n\n# Historical Episodes\nBefore making your decisions, reason around the following episodes: what happened, what did the leader decide on, and whether that can inform your reasoning.\n${episodesContent}`;
      }
    }

    return messages;
  }

  /**
   * Gets the list of active tools for this agent
   */
  public getActiveTools(parameters: StrategistParameters): string[] | undefined {
    return ["find-episodes", ...(super.getActiveTools(parameters) ?? [])];
  }

  /**
   * Gets extra tools that this agent provides to the context
   */
  public getExtraTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
    return {
      ...super.getExtraTools(context),
      "find-episodes": createSimpleTool({
        name: "find-episodes",
        description: "Steer the retrieval of historical episodes towards your specific query. Results available NEXT turn.",
        inputSchema: z.object({
          Situation: z.string().describe("A description of the situation to search for historical precedents")
        }),
        execute: async (input, parameters) => {
          parameters.workingMemory[episodeRequestKey] = input.Situation;
          return "Episode request stored. Similar historical episodes will be included in your context next turn.";
        }
      }, context)
    };
  }
}
