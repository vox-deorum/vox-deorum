/**
 * @module envoy/live-envoy
 *
 * Live game envoy that handles StrategistParameters-specific behavior.
 * Combines special message detection with game context assembly for live game interactions.
 * Provides a get-briefing internal tool for on-demand briefing retrieval and a send-message
 * tool that is the sole channel for speaking to the counterpart (interactive-diplomacy 05.1).
 */

import { ModelMessage, StepResult, Tool } from "ai";
import { Envoy } from "./envoy.js";
import { StrategistParameters, buildGameContextMessages } from "../strategist/strategy-parameters.js";
import { EnvoyThread } from "../types/index.js";
import { VoxContext } from "../infra/vox-context.js";
import { createBriefingTool } from "../briefer/briefing-utils.js";
import { createSendMessageTool } from "./send-message-tool.js";

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
   * Force a tool call every step so "speak" is an explicit action (the send-message tool), not raw
   * free text. Honored on the deployed model; vox-context neutralizes it to "auto" on Anthropic,
   * where the prompt steers instead and raw free text survives as the fallback reply.
   */
  public override toolChoice: string = "required";

  /**
   * A live envoy speaks ONLY via the `send-message` tool, so raw model free text is never a real
   * spoken reply: it is the Anthropic tool-force fallback (which the tool-rescue middleware may leave
   * as malformed tool-call text). The chat route swallows it from the live stream and the commit path
   * keeps it out of the archive, so the UI and a reload show only the explicit spoken reply.
   */
  public override suppressFreeText = true;

  /**
   * Hard step ceiling for every live envoy (overrides the base default of 3). A runaway support-tool
   * loop (get-briefing forever) or a string of empty responses always terminates by this many steps.
   */
  public override maxSteps: number = 10;

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
   * The base live-envoy tool set: on-demand briefings plus send-message, the sole channel for
   * speaking to the counterpart. Subclasses extend this with their own diplomatic tools.
   */
  public override getActiveTools(_parameters: StrategistParameters): string[] | undefined {
    return ["get-briefing", "send-message"];
  }

  /**
   * Provides the get-briefing internal tool (on-demand briefing retrieval/generation) and the
   * send-message tool (the streamed-as-text spoken reply). Subclasses spread this to add theirs.
   */
  public override getExtraTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
    return {
      "get-briefing": createBriefingTool(context),
      "send-message": createSendMessageTool(context),
    };
  }

  /**
   * Tool calls that complete a live envoy's conversational turn without requiring free text. The
   * shared {@link stopCheck} ends the turn once any of these is called. send-message is a completion
   * tool for every live envoy, so "the model spoke" collapses into "the model called a completion
   * tool"; subclasses override to add terminal tools such as the negotiator handoff or closure.
   */
  protected getCompletionTools(): Set<string> {
    return new Set(["send-message"]);
  }

  /**
   * Keeps a live envoy working until it has spoken (via send-message), deliberately ended its turn
   * through a completion tool, hit the hard step ceiling, or — on Anthropic, where the tool force is
   * neutralized — produced raw spoken free text. The inherited Envoy check is still called so each
   * response is persisted to the thread, but its generic terminal/maximum-step decisions do not
   * govern live envoys; this shared rule, generalized over {@link getCompletionTools}, does.
   *
   * Order matters: a completion tool ends the turn wherever it appears; otherwise the hard ceiling is
   * checked BEFORE the "keep working" branch so a stuck support-tool loop always terminates; a pending
   * supporting (non-completion) tool on the latest step means the envoy means to keep working; finally,
   * a spoken free-text turn with nothing left pending ends the loop (the Anthropic fallback).
   */
  public override stopCheck(
    parameters: StrategistParameters,
    input: EnvoyThread,
    lastStep: StepResult<Record<string, Tool>>,
    allSteps: StepResult<Record<string, Tool>>[],
    context: VoxContext<StrategistParameters>
  ): boolean {
    super.stopCheck(parameters, input, lastStep, allSteps, context);

    const completionTools = this.getCompletionTools();
    // A completion tool (send-message / negotiator handoff / closure) ends the turn wherever it appears.
    const hasCompletionTool = allSteps.some(step =>
      step.toolCalls.some(call => completionTools.has(call.toolName))
    );
    if (hasCompletionTool) return true;
    // Hard ceiling, checked before the keep-working branch so a runaway loop always stops.
    if (allSteps.length >= this.maxSteps) return true;
    // A pending supporting (non-completion) tool means the envoy means to keep working — e.g. it
    // spoke a short line then asked for a briefing — so don't stop on that step.
    const hasPendingSupportTool = lastStep.toolCalls.some(call => !completionTools.has(call.toolName));
    if (hasPendingSupportTool) return false;
    // No pending tool and no completion tool: stop once it has spoken raw free text (Anthropic fallback).
    return allSteps.some(step => Boolean(step.text?.trim()));
  }

  /**
   * Restricts special message mode (e.g., greetings) to the send-message tool only. With the tool
   * force honored on the deployed model an empty tool set would be uncompliable, so the greeting is
   * itself a send-message call streamed back as text — one path for all spoken output.
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
      config.activeTools = ["send-message"];
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
