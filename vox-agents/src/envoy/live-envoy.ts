/**
 * @module envoy/live-envoy
 *
 * Live game envoy that handles StrategistParameters-specific behavior.
 * Combines special message detection with game context assembly for live game interactions.
 * Provides a get-briefing internal tool for on-demand briefing retrieval.
 */

import { ModelMessage, StepResult, Tool } from "ai";
import { Envoy } from "./envoy.js";
import { StrategistParameters, buildGameContextMessages } from "../strategist/strategy-parameters.js";
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
   * Orchestrates initial messages with special message support. The always-present hint
   * anchors identity/audience/turn in both modes; an add-on follows it — the special
   * message's prompt in special mode, or the agent's default nudge in normal mode.
   * Special mode skips conversation history (and disables tools via prepareStep).
   */
  public async getInitialMessages(
    parameters: StrategistParameters,
    input: EnvoyThread,
    _context: VoxContext<StrategistParameters>
  ): Promise<ModelMessage[]> {
    const specialConfig = this.findLastSpecialMessage(input);
    const messages = this.getContextMessages(parameters, input);
    const addon = specialConfig ?? this.getDefaultAddon(parameters, input);

    if (!specialConfig) {
      // Normal mode: include conversation history; the LLM calls get-briefing if it needs detail.
      messages.push(...this.convertToModelMessages(
        this.filterSpecialMessages(input.messages)
      ));
    }
    messages.push({
      role: "user",
      content: `${this.getHint(parameters, input)} ${addon}`.trim()
    });
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
   * Returns the always-present hint that anchors the LLM on its identity, audience, and
   * current turn. Present in both normal and special message mode, followed by an add-on.
   */
  protected getHint(parameters: StrategistParameters, input: EnvoyThread): string {
    const { name: civName, leader } = this.getSelfIdentity(input);
    return `**HINT**: You represent ${civName}, serving ${leader}. You are speaking to ${this.formatUserDescription(input)}. The time is at turn ${parameters.turn}.`;
  }
}
