/**
 * @module briefer/simple-briefer
 *
 * Simple briefer agent that summarizes game state into a concise strategic briefing.
 * Condenses full game reports into key insights for strategic decision-making.
 */

import { ModelMessage } from "ai";
import { Briefer } from "./briefer.js";
import { VoxContext } from "../infra/vox-context.js";
import { getRecentGameState, StrategistParameters } from "../strategist/strategy-parameters.js";
import { jsonToMarkdown } from "../utils/tools/json-to-markdown.js";
import { getOffsetedTurn } from "../utils/prompts/game-speed.js";
import { getLastBriefingState } from "./briefing-utils.js";
import { cacheBreakpoint } from "../utils/models/cache-breakpoint.js";
import { renderSystemPrompt } from "../utils/prompts/prompt-files.js";

/**
 * A simple briefer agent that analyzes the game state and produces a concise briefing.
 * Summarizes key strategic information from detailed game reports.
 *
 * @class
 */
export class SimpleBriefer extends Briefer {
  /**
   * The name identifier for this agent
   */
  readonly name = "simple-briefer";

  /**
   * Human-readable description of what this agent does
   */
  readonly description = "Summarizes detailed game reports into concise strategic briefings highlighting threats, opportunities, and key insights";

  /**
   * Gets the system prompt for the briefer
   */
  public async getSystem(_parameters: StrategistParameters, _input: string, context: VoxContext<StrategistParameters>): Promise<string> {
    return renderSystemPrompt(context, 'simple-briefer');
  }

  /**
   * Gets the initial messages for the conversation
   */
  public async getInitialMessages(parameters: StrategistParameters, input: string, _context: VoxContext<StrategistParameters>): Promise<ModelMessage[]> {
    const state = getRecentGameState(parameters)!;
    const { YouAre, ...SituationData } = parameters.metadata || {};
    // Return the messages
    const messages: ModelMessage[] = [{
      role: "system",
      content: `
You are an expert briefing writer for ${parameters.metadata?.YouAre!.Leader}, leader of ${parameters.metadata?.YouAre!.Name} (Player ${parameters.playerID ?? 0}).

# Situation
${jsonToMarkdown(SituationData)}

# Your Civilization
${jsonToMarkdown(YouAre)}`.trim(),
      providerOptions: { ...cacheBreakpoint }
    }, {
      role: "user",
      content: `
# Victory Progress
Victory Progress: current progress towards each type of victory.

${jsonToMarkdown(state.victory)}

# Players
Players: summary reports about visible players in the world.

${jsonToMarkdown(state.players)}

# Cities
Cities: summary reports about discovered cities in the world.

${jsonToMarkdown(state.cities)}

# Military
Military: summary reports about tactical zones and visible units.

${jsonToMarkdown(state.military)}

# Events
Events: events since the last decision-making.

${jsonToMarkdown(state.mergedEvents ?? state.events)}

# Leader's Instruction
You are writing a strategic briefing for ${parameters.metadata?.YouAre!.Leader}, leader of ${parameters.metadata?.YouAre!.Name} (Player ${parameters.playerID ?? 0}), after turn ${parameters.turn}.

${input}`.trim()
    }];
    // Send in the past briefing from the closest prior decision point (a turn that actually
    // has a briefing), so pacing's skipped turns don't render an "undefined" comparison.
    const lastState = getLastBriefingState(parameters, getOffsetedTurn(parameters, -5), ["briefing"]);
    if (lastState) {
      messages.push({
        role: "user",
        content: `# Past Briefing
Past Briefing: your past briefing from ${parameters.turn - lastState.turn} turns ago (turn ${lastState.turn}) for comparison.
${lastState.reports["briefing"]}`
      });
    }
    return messages;
  }
  
  /** Briefers run at the low reasoning tier. */
  protected reasoningTier = "low" as const;
}
