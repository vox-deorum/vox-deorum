/**
 * @module strategist/simple-strategist-learned
 *
 * Learned strategist agent implementation.
 * Extends the staffed strategist with historical episode retrieval capability.
 * The LLM can request similar past game situations via the find-episodes tool,
 * and episodes are integrated into the next turn's context as reference material.
 */

import { Tool } from "ai";
import { z } from "zod";
import { SimpleStrategistStaffed } from "./simple-strategist-staffed.js";
import { VoxContext } from "../../infra/vox-context.js";
import { getRecentGameState, StrategistParameters } from "../strategy-parameters.js";
import { requestEpisodes, formatEpisodeResults } from "../../utils/prompts/episode-utils.js";
import { createSimpleTool } from "../../utils/tools/simple-tools.js";
import { renderSystemPrompt } from "../../utils/prompts/prompt-files.js";

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
  /** Keep the research-oriented learned strategist out of the guided game setup. */
  public override offeredInSetup = false;

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
  public async getSystem(parameters: StrategistParameters, _input: unknown, context: VoxContext<StrategistParameters>): Promise<string> {
    return renderSystemPrompt(context, 'simple-strategist-learned', {
      flavor: parameters.mode === "Flavor",
      episodes: !!parameters.workingMemory[episodeRequestKey]
    });
  }

  /**
   * Gets the extra reports for the staffed user messages: the historical episodes requested last
   * turn, formatted under the episode heading, or an empty string when none were retrieved.
   */
  protected override async getAdditionalReports(parameters: StrategistParameters, _input: unknown, _context: VoxContext<StrategistParameters>): Promise<string> {
    // Check for a pending episode request from last turn
    const pendingSituation = parameters.workingMemory[episodeRequestKey];
    const state = getRecentGameState(parameters)!;
    const results = await requestEpisodes(state, parameters, pendingSituation);
    delete parameters.workingMemory[episodeRequestKey];

    if (results.length === 0) {
      return "";
    }

    return `# Historical Episodes\nBefore making your decisions, reason around the following episodes: what happened, what did the leader decide on, and whether that can inform your reasoning.\n${formatEpisodeResults(results)}`;
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
