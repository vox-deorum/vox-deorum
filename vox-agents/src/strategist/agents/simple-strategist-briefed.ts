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
import { getRecentGameState, StrategistParameters } from "../strategy-parameters.js";
import { requestBriefing, assembleBriefings, buildCombinedInstruction, clearBrieferInstructions } from "../../briefer/briefing-utils.js";
import { renderSystemPrompt } from "../../utils/prompts/prompt-files.js";

/**
 * A briefed strategist agent that first requests a briefing before making strategic decisions.
 * Delegates game state summarization to a briefer agent to focus on high-level strategy.
 *
 * @class
 */
export class SimpleStrategistBriefed extends SimpleStrategistBase {
  /** The combined briefing generated before each decision. */
  public override modelDependencies = ["simple-briefer"];

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
  public async getSystem(parameters: StrategistParameters, _input: unknown, context: VoxContext<StrategistParameters>): Promise<string> {
    return renderSystemPrompt(context, 'simple-strategist-briefed', { flavor: parameters.mode === "Flavor" });
  }

  /**
   * Gets the initial messages for the conversation
   */
  public async getInitialMessages(parameters: StrategistParameters, _input: unknown, context: VoxContext<StrategistParameters>): Promise<ModelMessage[]> {
    const state = getRecentGameState(parameters)!;
    // Fold the focus-briefer instructions into one for the combined briefer
    const instruction = buildCombinedInstruction(parameters);

    // Get the briefing via requestBriefing (reads instruction from workingMemory, deduplicates concurrent calls)
    const briefing = await requestBriefing("combined", state, context, parameters);
    clearBrieferInstructions(parameters);
    if (!briefing) throw new Error("Failed to generate strategic briefings.");

    return this.buildBriefingMessages(parameters, state, context, assembleBriefings(briefing, instruction));
  }
  
  /**
   * Gets the list of active tools for this agent
   */
  public getActiveTools(parameters: StrategistParameters): string[] | undefined {
    // Return specific tools the strategist needs
    return ["focus-briefer", ...(super.getActiveTools(parameters) ?? [])]
  }
}
