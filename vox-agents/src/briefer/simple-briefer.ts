/**
 * @module briefer/simple-briefer
 *
 * Simple briefer agent that summarizes game state into a concise strategic briefing.
 * Condenses full game reports into key insights for strategic decision-making.
 */

import { ModelMessage, Tool } from "ai";
import { z } from "zod";
import { Briefer } from "./briefer.js";
import { VoxContext } from "../infra/vox-context.js";
import { getGameState, getRecentGameState, StrategistParameters } from "../strategist/strategy-parameters.js";
import { getModelConfig } from "../utils/models/models.js";
import { Model } from "../types/index.js";
import { jsonToMarkdown } from "../utils/tools/json-to-markdown.js";
import { createSimpleTool } from "../utils/tools/simple-tools.js";
import { getOffsetedTurn } from "../utils/prompts/game-speed.js";
import { SimpleStrategistBase } from "../strategist/agents/simple-strategist-base.js";
import { briefingInstructionKeys } from "./briefing-utils.js";

/**
 * A simple briefer agent that analyzes the game state and produces a concise briefing.
 * Summarizes key strategic information from detailed game reports.
 *
 * @class
 */
export class SimpleBriefer extends Briefer {
  /**
   * Common guidelines applicable to all briefing types
   */
  static readonly commonGuidelines = `- The briefing should be objective and analytical, not speculations, predictions, estimations, or suggestions.
- Report macro-level information sufficient for decision-making. Avoid raw, excessive, or tactical information (e.g. X/Y, unit IDs).
- Your leader can only set weights for a tactical AI to take concrete actions. NEVER suggest actions since the leader cannot execute it.
- Focus on factual information from the game state input. You have NO access to tactical AI's next decisions (e.g. which production is queued).
- If your leader asks for information you do not have or cannot validate, respond faithfully and explain the reason.`;

  /**
   * Description of Cities report
   */
  static readonly citiesPrompt = `- Cities: summary reports about discovered cities in the world.
  - Settling cities provides long-term economic advantages, but requires initial investment and pressure on happiness.`;

  /**
   * Description of Military report
   */
  static readonly militaryPrompt = `- Military: summary reports about tactical zones and visible units.
  - Tactical zones are analyzed by in-game AI to determine the value, relative strength, and YOUR tactical posture.
  - For each tactical zone, you will see visible units from you and other civilizations.`;

  /**
   * Description of Events report (generic)
   */
  static readonly eventsPrompt = `- Events: events since the last decision-making.`;

  /**
   * Description of Past Briefing section
   */
  static readonly pastBriefingPrompt = `- Past Briefing: your past briefing from a recent turn for comparison.`;

  /**
   * Standard instruction footer for all briefing types
   */
  static readonly instructionFooter = `# Instruction
Reason briefly. Write your briefing as a plain text document with a clear, direct, concise language.
Your leader has access to Victory Progress and Players sections. Do not repeat those information.`;

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
  public async getSystem(_parameters: StrategistParameters, _input: string, _context: VoxContext<StrategistParameters>): Promise<string> {
    return `
You are an expert briefing writer for Civilization V with the latest Vox Populi mod.
Your role is to produce a concise briefing based on the current game state, following your leader's instruction.
Your leader only has control over macro-level decision making. Focus on providing relevant information.

# Objective
Summarize the full game state into a strategic briefing that highlights:
- Economic, military, and diplomatic positions relative to opponents.
- If relevant, religion situation; and opportunities for peaceful expansion through settlement.
- Important events during the past turn.
- Comparison with the last available briefing.

# Guidelines
- Highlight important strategic changes and intelligence.
${SimpleBriefer.commonGuidelines}

# Resources
You will receive the following reports:
${SimpleStrategistBase.victoryConditionsPrompt}
${SimpleStrategistBase.playersInfoPrompt}
${SimpleBriefer.citiesPrompt}
${SimpleBriefer.militaryPrompt}
${SimpleBriefer.eventsPrompt}
${SimpleBriefer.pastBriefingPrompt}
  - Your leader can only see your most recent briefing.

${SimpleBriefer.instructionFooter}`.trim()
  }

  /**
   * Gets the initial messages for the conversation
   */
  public async getInitialMessages(parameters: StrategistParameters, input: string, context: VoxContext<StrategistParameters>): Promise<ModelMessage[]> {
    var state = getRecentGameState(parameters)!;
    // Get the information
    await super.getInitialMessages(parameters, input, context);
    const { YouAre, ...SituationData } = parameters.metadata || {};
    const { Options, ...Strategy } = state.options || {};
    // Return the messages
    const messages: ModelMessage[] = [{
      role: "system",
      content: `
You are an expert briefing writer for ${parameters.metadata?.YouAre!.Leader}, leader of ${parameters.metadata?.YouAre!.Name} (Player ${parameters.playerID ?? 0}).

# Situation
${jsonToMarkdown(SituationData)}

# Your Civilization
${jsonToMarkdown(YouAre)}`.trim(),
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } }
      }
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

${jsonToMarkdown(state.events)}

# Leader's Instruction
You are writing a strategic briefing for ${parameters.metadata?.YouAre!.Leader}, leader of ${parameters.metadata?.YouAre!.Name} (Player ${parameters.playerID ?? 0}), after turn ${parameters.turn}.

${input}`.trim()
    }];
    // Send in the past briefing
    var lastState = getGameState(parameters, getOffsetedTurn(parameters, -5));
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
  
  /**
   * Gets the language model to use for this agent execution.
   * Can return undefined to use the default model from VoxContext.
   * 
   * @param parameters - The execution parameters
   * @returns The language model to use, or undefined for default
   */
  public getModel(_parameters: StrategistParameters, _input: unknown, overrides: Record<string, Model | string>): Model {
    return getModelConfig(this.name, "low", overrides);
  }

  /**
   * Gets extra tools that this agent provides to the context.
   * These tools will be registered in addition to the agent's own tool representation.
   * Override this method to provide custom tools specific to this agent.
   *
   * @returns Record of tool name to Tool instance, or empty object if no extra tools
   */
  public getExtraTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
    return {
      "focus-briefer": createSimpleTool({
          name: "focus-briefer",
          description: "Set the focus for your briefer's next report",
          inputSchema: z.object({
            Instruction: z.string().describe("A short paragraph to focus your briefer's **next report**, e.g. what kind of information to prioritize")
          }),
          execute: async (input, parameters) => {
            // Store the instruction in working memory for the next briefing
            parameters.workingMemory[briefingInstructionKeys.combined] = input.Instruction;
            return `Briefer instruction set.`;
          }
        }, context)
    };
  }
}
