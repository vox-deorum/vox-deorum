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
import { cacheBreakpoint, countCacheBreakpoints, markBreakpointOnLast, MAX_CACHE_BREAKPOINTS } from "../utils/models/cache-breakpoint.js";
import { StrategistParameters, buildGameContextMessages } from "../strategist/strategy-parameters.js";
import { EnvoyThread } from "../types/index.js";
import { VoxContext } from "../infra/vox-context.js";
import { appendRecordsDirections } from "../knowledge/directions.js";
import { createBriefingTool } from "../briefer/briefing-utils.js";
import { createSendMessageTool } from "./tools/send-message-tool.js";
import { getValidCalls } from "../utils/tools/terminal-tools.js";
import type { DealRowRenderer } from "../utils/diplomacy/transcript/transcript-utils.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("live-envoy");

/**
 * Agent-specific context a live envoy layers around the chat record. `preamble`
 * messages sit BEFORE the chat record (grounding the transcript); `postscript` messages sit AFTER it
 * but before the always-last hint; `dealRenderer` expands deal transcript rows inline within the chat
 * record (or is omitted to leave their stored one-line Content). All fields are optional; base live
 * envoys supply none. Returned as a unit so a subclass can derive them from a single, consistent
 * reduction instead of recomputing the same fact from divergent sources.
 */
export interface LiveEnvoyContext {
  preamble?: ModelMessage[];
  postscript?: ModelMessage[];
  dealRenderer?: DealRowRenderer;
}

/**
 * Envoy specialized for live game sessions with StrategistParameters.
 * Assembles game context for conversations. Provides a get-briefing tool for
 * on-demand briefing retrieval and generation.
 *
 * @abstract
 * @class
 */
export abstract class LiveEnvoy extends Envoy<StrategistParameters> {
  /** The on-demand briefing agent used by the shared get-briefing tool. */
  public override modelDependencies = ["specialized-briefer"];

  /**
   * Force a tool call every step so "speak" is an explicit action (the send-message tool), not raw
   * free text. Honored on the deployed model; vox-context neutralizes it to "auto" on Anthropic,
   * where the prompt steers the model back to send-message and any raw free text is a degraded
   * fallback the envoy does not treat as an authoritative reply (see {@link speaksOnlyViaSendMessage}).
   */
  public override toolChoice: string = "required";

  /**
   * A malformed terminal/completion call (invalid input that never executed) is "no action taken" for a
   * live envoy — the model's terminal intent didn't happen, so the turn keeps going (below the ceiling)
   * to let it redo the call, rather than ending on a handoff/closure that never ran. See {@link stopCheck}.
   */
  public override retryMalformedTerminalCalls = true;

  /**
   * A live envoy speaks ONLY via the `send-message` tool, so raw model free text is never a real
   * spoken reply: it is the Anthropic tool-force fallback (which the tool-rescue middleware may leave
   * as malformed tool-call text). The chat route swallows it from the live stream and the commit path
   * keeps it out of the archive, so the UI and a reload show only the explicit spoken reply.
   */
  public override speaksOnlyViaSendMessage = true;

  /**
   * Hard step ceiling for every live envoy (overrides the base default of 3). A runaway support-tool
   * loop (get-briefing forever) or a string of empty responses always terminates by this many steps.
   */
  public override maxSteps: number = 10;

  /**
   * Orchestrates initial messages. The always-present hint anchors identity, audience and turn, and
   * is ALWAYS the final message for a live envoy, the last thing the model reads before it acts,
   * followed by the agent's default nudge. The agent's grounding brackets the conversation and its
   * deal rows render inline, both assembled together by {@link getExtraContext}.
   */
  public async getInitialMessages(
    parameters: StrategistParameters,
    input: EnvoyThread,
    context: VoxContext<StrategistParameters>
  ): Promise<ModelMessage[]> {
    const messages = this.getContextMessages(parameters, input);

    // File mode: the records directions join the stable prefix, ahead of the past-conversation
    // anchor. They carry no breakpoint of their own, so the breakpoint count is unchanged.
    appendRecordsDirections(messages, context);

    // Layer the agent's grounding around the chat record (see {@link LiveEnvoyContext}
    // for the bracket ordering and rationale) — `preamble` before it, `dealRenderer` inline within
    // it, `postscript` after it but still before the always-last hint.
    const extra = await this.getExtraContext(parameters, input, context);
    if (extra.preamble?.length) messages.push(...extra.preamble);

    // The chat record splits at the thread's open mark: settled past conversations compile into
    // ONE byte-stable block (a static prompt-cache anchor), while the ongoing exchange stays
    // native assistant/user messages (reasoning trail included) so the model keeps its context.
    // The last ongoing message carries the last static anchor; because each exchange only appends
    // committed rows, the next run at the same turn re-reads the whole record from cache. (See the
    // breakpoint strategy note in envoy.ts.)
    const { past, ongoing } = this.splitThreadMessages(input);
    const pastBlock = this.formatPastConversations(past, input, extra.dealRenderer);
    if (pastBlock) {
      messages.push({ role: "user", content: pastBlock, providerOptions: { ...cacheBreakpoint } });
    }
    const ongoingMessages = this.convertToModelMessages(ongoing, extra.dealRenderer, input);
    markBreakpointOnLast(ongoingMessages); // rides the last ongoing row; no-op when there are none
    messages.push(...ongoingMessages);
    if (extra.postscript?.length) messages.push(...extra.postscript);
    messages.push({
      role: "system",
      content: `${this.getHint(parameters, input)} ${this.getDefaultAddon(parameters, input)}`.trim()
    });

    // The Anthropic prompt cache rejects a request carrying more than MAX_CACHE_BREAKPOINTS
    // cache-control anchors. This assemble sets three (game context, past block, last ongoing row);
    // guard the ceiling so a future anchor added elsewhere surfaces as a warning here instead of a
    // provider error at request time.
    const breakpointCount = countCacheBreakpoints(messages);
    if (breakpointCount > MAX_CACHE_BREAKPOINTS) {
      logger.warn("Live envoy prompt exceeded the Anthropic cache-breakpoint ceiling", {
        breakpointCount, max: MAX_CACHE_BREAKPOINTS,
      });
    }

    return messages;
  }

  /**
   * Agent-specific context a live envoy layers around the chat record, assembled once per turn
   * (see {@link LiveEnvoyContext} for the layout and the single-source rationale). Base
   * live envoys add nothing; a subclass (the diplomat) overrides this to ground the turn with its
   * game state.
   */
  protected async getExtraContext(
    _parameters: StrategistParameters,
    _input: EnvoyThread,
    _context: VoxContext<StrategistParameters>
  ): Promise<LiveEnvoyContext> {
    return {};
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
   * tool"; subclasses extend this with terminal tools such as the negotiator handoff or closure.
   *
   * Declared through the shared {@link VoxAgent.completionTools} field, so the stop rule, the
   * continuation nudge, and the required-tool-choice instruction injected on Anthropic/Codex all
   * read the same set.
   */
  public override completionTools = ["send-message"];

  /**
   * Keeps a live envoy working until it has spoken (via send-message), deliberately ended its turn
   * through a completion tool, or hit the hard step ceiling. The inherited Envoy check is still called
   * so each response is persisted to the thread, but its return value is discarded: its generic
   * completion/maximum-step decisions do not govern live envoys; this shared rule, generalized over
   * {@link completionTools}, does.
   *
   * Raw free text does NOT end a forced-tool envoy's turn. A live envoy speaks only through
   * send-message (see {@link speaksOnlyViaSendMessage}), so on Anthropic — where the tool force is neutralized
   * to "auto" — any free text is a degraded fallback the envoy ignores, working on until it actually
   * calls a completion tool. Only a subclass that opts out of the force (toolChoice !== "required")
   * treats free text as a completing reply.
   *
   * Order matters: a completion tool ends the turn wherever it appears; otherwise the hard ceiling is
   * checked BEFORE the "keep working" branch so a stuck support-tool loop always terminates; a pending
   * supporting (non-completion) tool on the latest step means the envoy means to keep working; finally,
   * a spoken free-text turn ends the loop only for a non-required (auto) subclass.
   */
  public override stopCheck(
    parameters: StrategistParameters,
    input: EnvoyThread,
    lastStep: StepResult<Record<string, Tool>>,
    allSteps: StepResult<Record<string, Tool>>[],
    context: VoxContext<StrategistParameters>
  ): boolean {
    this.recordStep(parameters, input, lastStep);

    const completionTools = new Set(this.completionTools);
    // A malformed completion call this step means the model's terminal intent never ran. Keep working
    // (below the ceiling) so it can redo the call — even if a VALID completion also fired in the same
    // step (that line was already spoken; the model sees it plus the tool-error and rarely re-speaks).
    // The shared root rule ({@link VoxAgent.retriesMalformedTerminal}) is applied here with the live
    // envoy's completion-tool set; a single malformed call already retries below (getValidCalls excludes
    // it, so hasCompletionTool is false and the final predicate returns false) — this covers the mixed step.
    if (this.retriesMalformedTerminal(lastStep, allSteps, context, (name) => completionTools.has(name))) {
      return false;
    }
    // A completion tool (send-message / negotiator handoff / closure) ends the turn wherever it
    // appears. Only valid calls count: an invalid send-message never executed, so nothing was spoken.
    const hasCompletionTool = allSteps.some(step =>
      getValidCalls(step).some(call => completionTools.has(call.toolName))
    );
    if (hasCompletionTool) return true;
    // Hard ceiling, checked before the keep-working branch so a runaway loop always stops.
    if (this.reachedStepLimit(allSteps, context)) return true;
    // A pending supporting (non-completion) tool means the envoy means to keep working — e.g. it
    // spoke a short line then asked for a briefing — so don't stop on that step.
    const hasPendingSupportTool = getValidCalls(lastStep).some(call => !completionTools.has(call.toolName));
    if (hasPendingSupportTool) return false;
    // No pending tool and no completion tool. A forced-tool live envoy (toolChoice="required", the
    // default) speaks ONLY through send-message, so raw free text is never an authoritative reply
    // (see speaksOnlyViaSendMessage) and must not end the turn: the envoy keeps working until it actually
    // calls a completion tool or hits the ceiling above. Where the force is neutralized the injected
    // instruction names `completionTools` as what ends the turn, so this branch is the fallback for a
    // model that ignored it. Only a subclass that opts out of the tool force (toolChoice !== "required")
    // treats raw spoken free text as a completing reply.
    return this.toolChoice !== "required" && allSteps.some(step => Boolean(step.text?.trim()));
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
   * current turn, followed by the agent's default nudge.
   */
  protected getHint(parameters: StrategistParameters, input: EnvoyThread): string {
    const { name: civName, leader } = this.getSelfIdentity(input);
    return `**HINT**: You represent ${civName}, serving ${leader}. You are speaking to ${this.formatUserDescription(input)}. The time is at turn ${parameters.turn}.`;
  }
}
