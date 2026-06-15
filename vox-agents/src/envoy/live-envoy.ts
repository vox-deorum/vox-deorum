/**
 * @module envoy/live-envoy
 *
 * Live game envoy that handles StrategistParameters-specific behavior.
 * Combines special message detection with game context assembly for live game interactions.
 * Provides a get-briefing internal tool for on-demand briefing retrieval.
 */

import { ModelMessage, StepResult, Tool } from "ai";
import { Envoy, ParticipantIdentity } from "./envoy.js";
import { StrategistParameters, buildGameContextMessages, getRecentGameState } from "../strategist/strategy-parameters.js";
import { EnvoyThread } from "../types/index.js";
import { VoxContext } from "../infra/vox-context.js";
import { createBriefingTool } from "../briefer/briefing-utils.js";

/**
 * Envoy specialized for live game sessions with StrategistParameters.
 * Handles special message detection (e.g., {{{Greeting}}}) and assembles
 * game context for conversations. Provides a get-briefing tool for
 * on-demand briefing retrieval and generation.
 *
 * @abstract
 * @class
 */
export abstract class LiveEnvoy extends Envoy<StrategistParameters> {
  /**
   * Allow the LLM to decide when to call tools rather than forcing it
   */
  public override toolChoice: string = "auto";

  /**
   * Orchestrates initial messages with special message support.
   * Detects special messages in the last user message and generates
   * appropriate prompts. Falls back to full context + history for normal messages.
   */
  public async getInitialMessages(
    parameters: StrategistParameters,
    input: EnvoyThread,
    _context: VoxContext<StrategistParameters>
  ): Promise<ModelMessage[]> {
    const specialConfig = this.findLastSpecialMessage(input);
    const messages = this.getContextMessages(parameters, input);

    if (specialConfig) {
      // Special mode: ignore the rest
      messages.push({
        role: "user",
        content: `
# Special Instruction
${specialConfig.prompt}`.trim()
      })
      return messages;
    } else {
      // Normal mode: add hint, the LLM calls get-briefing if it needs detailed context
      messages.push(...this.convertToModelMessages(
        this.filterSpecialMessages(input.messages)
      ));
      messages.push({
        role: "user",
        content: this.getHint(parameters, input)
      });
    }
    return messages;
  }

  /**
   * Restricts the envoy to only the get-briefing tool
   */
  public override getActiveTools(_parameters: StrategistParameters): string[] | undefined {
    return ["get-briefing"];
  }

  /**
   * Provides the get-briefing internal tool for on-demand briefing retrieval.
   * Fetches existing briefings from the current game state, or generates new ones
   * via the specialized-briefer agent if they don't exist.
   */
  public override getExtraTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
    return { "get-briefing": createBriefingTool(context) };
  }

  /**
   * Disables tools when in special message mode.
   * Special prompts (e.g., greetings) only need text generation, not tool calls.
   */
  public override async prepareStep(
    parameters: StrategistParameters,
    input: EnvoyThread,
    lastStep: StepResult<Record<string, Tool>> | null,
    allSteps: StepResult<Record<string, Tool>>[],
    messages: ModelMessage[],
    context: VoxContext<StrategistParameters>
  ) {
    const config = await super.prepareStep(parameters, input, lastStep, allSteps, messages, context);
    if (this.isSpecialMode(input)) {
      config.activeTools = [];
    }
    return config;
  }

  // Game context assembly

  /**
   * Returns the game context messages: civilization identity, players, and strategies.
   * Briefings are fetched on-demand via the get-briefing tool rather than injected here.
   */
  protected getContextMessages(parameters: StrategistParameters, _input: EnvoyThread): ModelMessage[] {
    return buildGameContextMessages(parameters);
  }

  /**
   * Identity of a player from the live game state: the agent's own seat from
   * `metadata.YouAre`, any other visible player from the most recent game state's
   * players report. Returns undefined when the player has no identity here (e.g. the
   * observer sentinel, or a counterpart not visible in the current state).
   */
  protected getParticipantIdentity(parameters: StrategistParameters, playerID: number): ParticipantIdentity | undefined {
    if (playerID === parameters.playerID) {
      const youAre = parameters.metadata?.YouAre;
      if (youAre?.Name) return { name: youAre.Name, leader: youAre.Leader ?? '' };
    }
    const data = getRecentGameState(parameters)?.players?.[playerID.toString()];
    if (data && typeof data === 'object') {
      const civ = (data as Record<string, unknown>).Civilization;
      const leader = (data as Record<string, unknown>).Leader;
      if (typeof civ === 'string') {
        return { name: civ, leader: typeof leader === 'string' ? leader : '' };
      }
    }
    return undefined;
  }

  // Abstract methods

  /**
   * Returns a short contextual reminder that anchors the LLM on its role,
   * audience, and current turn. Used as the sole context in special message mode,
   * and typically appended to game state messages in normal mode.
   */
  protected abstract getHint(parameters: StrategistParameters, input: EnvoyThread): string;
}
