/**
 * @module infra/vox-agent
 *
 * Base agent infrastructure for Vox Agents.
 * Defines the abstract VoxAgent class and AgentParameters interface that all agents must implement.
 * Provides lifecycle hooks and execution control for agent behavior.
 */

import { Tool, StepResult, ModelMessage } from "ai";
import { createLogger } from "../utils/logger.js";
import { z, ZodObject } from "zod";
import { Model, ReasoningEffort } from "../types/index.js";
import type { VoxContext } from "./vox-context.js";
import type { ExecuteTokenOutput } from "./vox-run.js";
import { getModelConfig, type ModelSize, resolveToolFraming, selectModelReference } from "../utils/models/models.js";
import { getValidCalls, hasOnlyTerminalCalls, isTerminalTool } from "../utils/tools/terminal-tools.js";
import { buildClosingReminder } from "../utils/prompts/closing-reminder.js";
import { bashToolName } from "../utils/tools/tool-names.js";
import { buildRescuePrompt, stripJsonFence } from "../utils/models/text-cleaning.js";
import { appendReminder } from "../utils/prompts/reminders.js";
// @ts-expect-error - jaison doesn't have type definitions
import jaison from 'jaison';

/**
 * Parameters for configuring agent execution.
 * Provides context about the game state and timing for agent decision-making.
 */
export interface AgentParameters {
  /** ID of the player for whom the agent is serving, -1 for none */
  playerID: number;
  /** ID of the game for whom the agent is serving */
  gameID: string;
  /** Current game turn number */
  turn: number;
  /** Optional cleanup method for releasing resources (database connections, etc.) */
  close?: () => Promise<void>;
}

/** The model-tier decision made before one agent execution begins. */
export interface TriageDecision {
  /** Model-size tier selected for this execution. */
  tier: ModelSize;
  /** How the execution tier was selected. */
  source?: 'evaluator' | 'shortcut' | 'caller' | 'failed';
  /** Optional evaluator answers retained for hooks and diagnostics. */
  answers?: Record<string, unknown>;
  /** Optional human-readable reason for the decision. */
  note?: string;
}

/** Prompt material assembled once before triage and reused by the selected execution path. */
export interface PreparedAgentState {
  /** System prompt for the agent. */
  system: string;
  /** Initial conversation messages, excluding the system prompt. */
  messages: ModelMessage[];
  /** Tools declared for this run ({@link VoxAgent.getRunTools}), or undefined for all registered tools. */
  tools: string[] | undefined;
}

/**
 * Abstract base class for all Vox Agents.
 * Provides a framework for implementing AI agents that can be executed within the Vox context.
 * 
 * @template TParameters - The type of parameters that will be passed to this agent
 * @template TInput - The type of input this agent accepts when called as a tool
 * @template TOutput - The type of output this agent produces when called as a tool
 */
export abstract class VoxAgent<TParameters extends AgentParameters, TInput = unknown, TOutput = unknown> {
  protected logger = createLogger(this.constructor.name);
  
  /**
   * The name identifier for this agent
   */
  abstract readonly name: string;

  /**
   * Human-readable description of what this agent does
   */
  abstract readonly description: string;

  /** Optional player-facing name for agent-selection controls. */
  public displayName?: string;

  /**
   * Tags for categorizing and filtering agents (e.g., ["chat", "strategist", "briefer"])
   */
  public tags: string[] = [];

  /**
   * Generic capability flag: when true, this agent only operates inside a civ↔civ diplomacy
   * conversation and must never be run as an ordinary observer/telepathist chat. The invariant is
   * enforced at the single execution boundary `VoxContext.execute`, which rejects such an agent
   * unless its input carries the diplomacy flag, so no entry point can bypass it. The web chat route
   * and the telepathist CLI additionally reject it up front with a clearer message, and the chat
   * dialog forces the Diplomacy form (never the regular Observer panel) so it is never selected for
   * an ordinary chat.
   */
  public diplomacyOnly = false;

  /** Whether the game setup wizard offers this agent as a strategist style. */
  public offeredInSetup = false;

  /**
   * Generic capability flag: when true, this agent speaks ONLY through an explicit tool (the live
   * envoy's `send-message`), so raw model free text is never a legitimate spoken reply: it is the
   * Anthropic tool-force fallback (and, with the tool-rescue middleware, can carry malformed
   * tool-call text that renders badly). The streaming chat route swallows native text chunks for
   * such an agent, and the diplomacy commit path archives only the explicit spoken reply, so live
   * and reload agree and the junk reaches neither. Default false (ordinary agents speak as free text).
   *
   * This doubles as the diplomacy-voice contract: opening a diplomacy thread rejects any voice
   * without it (see the chat factory), because a reply that never passes through `send-message` is
   * never archived. Diplomacy code downstream of that gate therefore treats "the spoken reply is a
   * send-message argument" as an invariant rather than a per-turn condition.
   */
  public speaksOnlyViaSendMessage = false;

  /**
   * Optional description for when this agent is exposed as a tool
   */
  public toolDescription?: string;
  
  /**
   * Optional input schema for when this agent is exposed as a tool
   */
  public inputSchema?: z.ZodObject<any>;

  /**
   * Optional caller-facing schema for this agent's `call-<name>` handoff tool. When set, the
   * agent-tool exposes THIS to the calling LLM (instead of {@link inputSchema}) and the
   * validated arguments are mapped into TInput by {@link resolveHandoffInput}. Use this when
   * the agent's real input carries ambient context the caller should not have to author.
   */
  public handoffSchema?: z.ZodObject<any>;

  /**
   * Optional output schema for when this agent is exposed as a tool
   */
  public outputSchema?: z.ZodSchema<TOutput>;

  /**
   * Whether we want to force the LLM to call tools (only works when activeTools exist)
   */
  public toolChoice: string = "required";

  /**
   * When true, a step whose terminal/completion intent was MALFORMED (an invalid tool call that never
   * executed) does NOT end the turn — the agent keeps working (below {@link stepLimit}) so the model can
   * redo the call. Default false: non-live agents keep the "a terminal call ends the turn" rule. The
   * keep-working logic lives once on the base ({@link retriesMalformedTerminal}) and is applied by
   * {@link stopCheck} here (and by `LiveEnvoy.stopCheck`, which supplies its completion-tool set).
   */
  public retryMalformedTerminalCalls: boolean = false;

  /**
   * When true, agent-tool invocations return immediately without waiting for completion.
   * The agent runs asynchronously in a detached trace context (root span).
   */
  public fireAndForget: boolean = false;

  /**
   * Maximum steps before forced stop (default: 3). See {@link stepLimit} for the limit with files on.
   */
  public maxSteps: number = 3;

  /**
   * The step limit for one execution: {@link maxSteps}, raised to the files quota when the
   * context's files setting is on, so workspace work and the final decision share one budget.
   *
   * @param context - The VoxContext of the execution
   */
  public stepLimit(context: VoxContext<TParameters>): number {
    return context.files ? Math.max(this.maxSteps, context.files.quota) : this.maxSteps;
  }

  /**
   * Whether an execution has used its whole {@link stepLimit}, logging a warning when it has. Stop
   * checks use this as their hard ceiling so a runaway loop always ends.
   *
   * @param allSteps - All steps executed so far
   * @param context - The VoxContext of the execution
   */
  protected reachedStepLimit(allSteps: unknown[], context: VoxContext<TParameters>): boolean {
    const limit = this.stepLimit(context);
    if (allSteps.length < limit) return false;
    this.logger.warn(`Reached maximum step limit (${limit}), stopping agent`);
    return true;
  }

  /**
   * Tool names whose successful call completes this agent's run — the single source of truth for
   * "these end the turn", consumed by {@link stopCheck} (and `LiveEnvoy.stopCheck`), by
   * {@link continuationNudge}, and by the required-tool-choice provider middleware, which names them
   * as the finishing set so a model cannot mistake a support call for a completion. Distinct from
   * {@link toolChoice} `"required"`, which only means "some tool must be called this step".
   * When set, stopCheck uses completion-tool membership instead of default terminal-call logic.
   */
  public completionTools?: string[];

  /**
   * The single closing reminder appended as the last user message of a step, after
   * {@link prepareStep} has resolved the tools this step may run (`executable`). When the step's
   * tool choice is `required`, it says the model must call tools; this lives here, not in provider
   * middleware, so the system text stays the same when a step drops to auto. When the step is
   * `narrowed` (some of the run's tools were removed but stay declared), it names the allowed tools
   * and says other calls will error. With `stepsLeft` (set when files are on) it counts down the
   * steps left for the final decision. From the second step on it also
   * nudges the model to finalize with the {@link completionTools} that are allowed, so it never names
   * a tool the model cannot run. Return undefined to add nothing (e.g. a replay agent that must not
   * perturb the reproduced prompt).
   */
  public continuationNudge(
    _parameters: TParameters,
    step: { executable: string[]; narrowed: boolean; step: number; required: boolean; stepsLeft?: number },
  ): string | undefined {
    return buildClosingReminder(step.executable, this.completionTools, step);
  }

  /**
   * When true, this agent handles messages programmatically without an LLM.
   * The handleMessage() method is called instead of the normal LLM execution path.
   */
  public programmatic: boolean = false;

  /**
   * Handles a message programmatically without invoking an LLM.
   * Only called when `programmatic` is true. Override in subclasses.
   *
   * @param _parameters - The execution parameters
   * @param _input - The agent input (e.g., EnvoyThread)
   * @param _message - The user's message text
   * @param _streamProgress - Callback to stream text deltas to the client
   */
  public async handleMessage(
    _parameters: TParameters,
    _input: TInput,
    _message: string,
    _streamProgress: (text: string) => void
  ): Promise<void> {
    throw new Error('handleMessage not implemented for programmatic agent');
  }

  /**
   * Model tier (reasoning-effort level) this agent runs at. Subclasses set this to select a
   * non-default tier instead of overriding {@link getModel}; the base getModel forwards it to
   * getModelConfig. Undefined keeps getModelConfig's default resolution.
   */
  protected reasoningTier?: ReasoningEffort | 'default';

  /** Size alias this agent uses when it has no explicit model assignment. */
  public modelSize: ModelSize = 'default';

  /**
   * Registered child agents this agent can invoke with the same context model overrides.
   * Session startup resolves this fixed dependency graph before Civilization V launches.
   */
  public modelDependencies: readonly string[] = [];

  /**
   * Whether this agent delegates deal decisions to the seat's configured negotiator.
   * Session startup resolves that per-seat target when this is enabled.
   */
  public usesSeatNegotiator = false;

  /**
   * Gets the language model to use for this agent execution.
   * Can return undefined to use the default model from VoxContext.
   *
   * @param parameters - The execution parameters
   * @returns The language model to use, or undefined for default
   */
  public getModel(
    _parameters: TParameters,
    _input: TInput,
    overrides: Record<string, Model | string>,
    tier: ModelSize = this.modelSize
  ): Model {
    return getModelConfig(selectModelReference(this.name, tier, overrides), this.reasoningTier, overrides);
  }

  /** Optionally choose a model tier before model selection and prompt construction. */
  public triage?(
    parameters: TParameters,
    input: TInput,
    context: VoxContext<TParameters>,
    prepared: PreparedAgentState
  ): Promise<TriageDecision | undefined>;

  /** Run a structured evaluation instead of the chat loop when an agent has a deterministic result path. */
  public executeEvaluation?(
    parameters: TParameters,
    input: TInput,
    context: VoxContext<TParameters>,
    prepared: PreparedAgentState,
    model: Model,
    tokenOutput?: ExecuteTokenOutput
  ): Promise<TOutput | undefined>;
  
  /**
   * Gets the system prompt for this agent.
   * This defines the agent's behavior and capabilities.
   * 
   * @param parameters - The execution parameters
   * @returns The system prompt string
   */
  public abstract getSystem(parameters: TParameters, _input: TInput, _context: VoxContext<TParameters>): Promise<string>;
  
  /**
   * Gets this agent's full tool list. {@link getRunTools} picks one run's tools from it.
   *
   * @param parameters - The execution parameters
   * @returns Array of tool names, or undefined for all registered tools
   */
  public getActiveTools(_parameters: TParameters): string[] | undefined {
    return [];
  }

  /**
   * Gets the tools declared to the model for one run, resolved once before the first step. Defaults
   * to {@link getActiveTools}, plus `bash` when the seat has files on and that list is non-empty
   * (undefined already means all registered tools). Override to restrict a whole run by its input
   * (e.g. a special message that may only be answered by speaking); a restricted list leaves bash
   * out. The list never changes within the run, so the cached prompt prefix stays the same across steps.
   *
   * @param parameters - The execution parameters
   * @param input - The agent input for this execution
   * @param context - The VoxContext for this execution
   * @returns Array of tool names to declare, or undefined for all registered tools
   */
  public async getRunTools(
    parameters: TParameters,
    _input: TInput,
    context: VoxContext<TParameters>
  ): Promise<string[] | undefined> {
    const tools = this.getActiveTools(parameters);
    if (!tools?.length || !context.tools[bashToolName] || tools.includes(bashToolName)) return tools;
    return [...tools, bashToolName];
  }
  
  /**
   * The shared keep-working rule for {@link retryMalformedTerminalCalls}. When the flag is on and the
   * turn is still below {@link stepLimit}, a last step whose terminal/completion intent was MALFORMED —
   * an invalid tool call that never executed, with `isCompletion` deciding which tool names are
   * terminal for THIS agent — must NOT end the turn, so the model can redo the call on the next step
   * (the SDK feeds the tool-error back). Returns true only when the caller should force another step;
   * each `stopCheck` ORs it into its own decision — the base below with its terminal-tool notion, and
   * `LiveEnvoy` with its completion-tool set. Default flag is false, so this is a no-op unless opted in.
   */
  protected retriesMalformedTerminal(
    lastStep: StepResult<Record<string, Tool>>,
    allSteps: StepResult<Record<string, Tool>>[],
    context: VoxContext<TParameters>,
    isCompletion: (toolName: string) => boolean
  ): boolean {
    return (
      this.retryMalformedTerminalCalls &&
      allSteps.length < this.stepLimit(context) &&
      lastStep.toolCalls.some((call) => call.invalid && isCompletion(call.toolName))
    );
  }

  /**
   * Determines whether the agent should stop execution.
   * Called after each step to check if the generation should continue.
   *
   * @param parameters - The execution parameters
   * @param lastStep - The most recent step result
   * @param allSteps - All steps executed so far
   * @param context - The VoxContext for looking up tool metadata
   * @returns True if the agent should stop, false to continue
   */
  public stopCheck(
    _parameters: TParameters,
    _input: TInput,
    lastStep: StepResult<Record<string, Tool>>,
    allSteps: StepResult<Record<string, Tool>>[],
    context: VoxContext<TParameters>
  ): boolean {
    // A malformed terminal call keeps the turn open for agents that opt in (default off, so this is a
    // no-op for existing agents). Checked first so a redo isn't lost to a same-step valid terminal call.
    if (this.retriesMalformedTerminal(lastStep, allSteps, context, (name) => isTerminalTool(name, context.mcpToolMap))) {
      return false;
    }
    if (this.completionTools?.length) {
      // Completion-tools mode: stop when any completion tool succeeds
      if (allSteps.some(step =>
        step.toolResults.some(r => this.completionTools!.includes(r.toolName) && r.output)
      )) return true;
    } else {
      // Default mode: stop on empty responses or terminal-only calls (invalid calls never
      // execute, so a step carrying only invalid calls counts as empty)
      if (getValidCalls(lastStep).length === 0 && !lastStep.text?.trim()) {
        return this.reachedStepLimit(allSteps, context);
      }
      if (hasOnlyTerminalCalls(lastStep, context.mcpToolMap)) {
        return true;
      }
    }
    return this.reachedStepLimit(allSteps, context);
  }
  
  /**
   * Manually post-process LLM results and send back the output.
   * Can be async to allow tool calls or other asynchronous processing.
   *
   * @param parameters - The execution parameters
   * @param input - The starting input
   * @param finalText - The final generated text
   * @param context - The VoxContext for calling tools
   * @returns The processed output or undefined
   */
  public async getOutput(
    _parameters: TParameters,
    _input: TInput,
    finalText: string,
    _context: VoxContext<TParameters>
  ): Promise<TOutput | undefined> {
    if (finalText === "") return;
    if (this.outputSchema) {
      const cleanedText = typeof finalText === 'string'
        ? stripJsonFence(finalText)
        : finalText;
      const parsed = typeof cleanedText === 'string' ? jaison(cleanedText) : cleanedText;
      return this.outputSchema.parse(parsed);
    } else {
      return finalText as unknown as TOutput;
    }
  }

  /**
   * Post-processes the output before returning it.
   * Override this method to modify the output after getOutput.
   *
   * @param output - The output from getOutput
   * @returns The post-processed output
   */
  public postprocessOutput(
    _parameters: TParameters,
    _input: TInput,
    output: TOutput
  ): TOutput {
    return output;
  }

  /**
   * Maps the caller-authored handoff arguments (validated against {@link handoffSchema}, or
   * {@link inputSchema} when no handoff schema is set) into this agent's input (TInput) when it
   * is invoked as a `call-<name>` agent-tool. Override to enrich the arguments with ambient
   * context such as the caller's own input (`context.currentInput`) — at call time the caller's
   * input is still current, because the agent-tool runs inside the caller's step before
   * {@link VoxContext.execute} swaps it. Defaults to passing the arguments through unchanged.
   *
   * @param callerArgs - The arguments the calling LLM supplied to the agent-tool
   * @param context - The VoxContext for this execution (its `currentInput` is the caller's input)
   * @returns The input to execute this agent with
   */
  public resolveHandoffInput(callerArgs: unknown, _context: VoxContext<TParameters>): TInput {
    return callerArgs as TInput;
  }

  /**
   * Resolve which concrete agent the `call-<name>` handoff should execute. Defaults to this
   * agent. Override to dispatch to a context-resolved variant — e.g. a per-seat custom agent
   * looked up from the active session. The resolved target MUST accept the same input shape,
   * since {@link resolveHandoffInput} (this agent's) still maps the caller's arguments.
   *
   * @param context - The VoxContext for this execution (its `currentInput` is the caller's input)
   * @returns The registered name of the agent to execute for this handoff
   */
  public resolveHandoffTarget(_context: VoxContext<TParameters>): string {
    return this.name;
  }

  /**
   * Gets the initial messages to include in the conversation.
   * These messages will be added after the system prompt.
   *
   * @param parameters - The execution parameters
   * @param input - The input passed to the agent
   * @param context - The VoxContext for this execution
   * @returns Array of initial messages, or empty array if none
   */
  public async getInitialMessages(_parameters: TParameters, _input: TInput, _context: VoxContext<TParameters>): Promise<ModelMessage[]> {
    return [];
  }

  /**
   * Gets extra tools that this agent provides to the context.
   * These tools will be registered in addition to the agent's own tool representation.
   * Override this method to provide custom tools specific to this agent.
   *
   * @param context - The VoxContext for this tool
   * @returns Record of tool name to Tool instance, or empty object if no extra tools
   */
  public getExtraTools(_context: VoxContext<TParameters>): Record<string, Tool> {
    return {};
  }
  
  /**
   * Prepares the next step in the agent execution.
   * Allows dynamic modification of the execution context for each step.
   *
   * A returned `activeTools` may only remove tools from the run's declared list ({@link getRunTools})
   * after an earlier step ran, such as closing a quota; an agent never adds tools mid-run, and a
   * restriction known before the first step belongs in getRunTools. Removed tools stay declared to the
   * model; a call to one returns an error without executing, and the closing reminder
   * ({@link continuationNudge}) names the tools available for the step. Telemetry and Oracle rely on
   * this: the first step's `step.tools` is the run's declared list.
   *
   * @param parameters - The execution parameters
   * @param lastStep - The most recent step result
   * @param allSteps - All steps executed so far
   * @param messages - The current message history
   * @returns Configuration for the next step, or empty object for defaults
   */
  public async prepareStep(
    parameters: TParameters,
    input: TInput,
    lastStep: StepResult<Record<string, Tool>> | null,
    allSteps: StepResult<Record<string, Tool>>[],
    messages: ModelMessage[],
    context: VoxContext<TParameters>
  ) {
    const config: {
      model?: Model;
      activeTools?: string[];
      messages?: ModelMessage[];
      outputSchema?: ZodObject;
    } = {};

    // Handle messages
    const toolChoice = this.toolChoice;
    if (lastStep === null) {
      config.messages = [...messages];
    } else if (lastStep.toolCalls.length === 0 && (toolChoice === "required" || toolChoice === "tool" || !lastStep.text?.trim())) {
      // Rescue a step that ended without a tool call (or, under auto, without any text). A reply
      // with text stays in the history, reasoning included, so the retry builds on what the model
      // already worked out. An empty or reasoning-only reply is stripped: providers can reject it
      // (OpenAI requires a reasoning item to be followed by output).
      const baseMessages = config.messages || messages;
      const responseMessages = lastStep.response.messages;
      // Checks the cleaned response messages, not lastStep.text: tool-rescue artifact cleanup may
      // have removed every text part from the copy that joined the history.
      const keepReply = responseMessages.some(msg => typeof msg.content === 'string'
        ? msg.content.trim() !== ''
        : msg.content.some(part => part.type === 'text' && part.text.trim() !== ''));
      const cleaned = keepReply
        ? [...baseMessages]
        : baseMessages.filter(msg => !responseMessages.some(respMsg => respMsg === msg));
      // Match the rescue wording to the model's framing so a claude-code model is
      // asked for an "action", not pointed at its host "tools".
      const rescueFraming = resolveToolFraming(this.getModel(
        parameters,
        input,
        context.modelOverrides,
        context.currentTriage?.tier
      ));
      const rescue = buildRescuePrompt(toolChoice, rescueFraming);
      config.messages = appendReminder(cleaned, rescue);
    }

    config.model = this.getModel(parameters, input, context.modelOverrides, context.currentTriage?.tier);

    return config;
  }
}
