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
import { Model } from "../types/index.js";
import { VoxContext } from "./vox-context.js";
import { getModelConfig } from "../utils/models/models.js";
import { hasOnlyTerminalCalls } from "../utils/tools/terminal-tools.js";
import { buildRescuePrompt } from "../utils/models/text-cleaning.js";
// @ts-ignore - jaison doesn't have type definitions
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

  /**
   * Optional description for when this agent is exposed as a tool
   */
  public toolDescription?: string;
  
  /**
   * Optional input schema for when this agent is exposed as a tool
   */
  public inputSchema?: z.ZodSchema<TInput>;

  /**
   * Optional caller-facing schema for this agent's `call-<name>` handoff tool. When set, the
   * agent-tool exposes THIS to the calling LLM (instead of {@link inputSchema}) and the
   * validated arguments are mapped into TInput by {@link resolveHandoffInput}. Use this when
   * the agent's real input carries ambient context the caller should not have to author.
   */
  public handoffSchema?: z.ZodTypeAny;

  /**
   * Optional output schema for when this agent is exposed as a tool
   */
  public outputSchema?: z.ZodSchema<TOutput>;

  /**
   * Whether we will remove used tools from the active list
   */
  public removeUsedTools: boolean = false;
  
  /**
   * Whether we want to force the LLM to call tools (only works when activeTools exist)
   */
  public toolChoice: string = "required";

  /**
   * Whether we will only keep the last round of agent-tool exchanges (i.e. system + user + last reasoning (if any) + last text (if any) + last tool call + last tool result)
   */
  public onlyLastRound: boolean = false;

  /**
   * When true, agent-tool invocations return immediately without waiting for completion.
   * The agent runs asynchronously in a detached trace context (root span).
   */
  public fireAndForget: boolean = false;

  /**
   * Maximum steps before forced stop (default: 3)
   */
  public maxSteps: number = 3;

  /**
   * Tool names that must be called to complete execution.
   * When set, stopCheck uses required-tool membership instead of default terminal-call logic.
   */
  public requiredTools?: string[];

  /**
   * Generates a nudge message when the loop continues without calling required tools.
   * Called with current parameters to produce a mode-aware reminder string.
   */
  public continuationNudge?: (parameters: TParameters) => string;

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
   * Gets the language model to use for this agent execution.
   * Can return undefined to use the default model from VoxContext.
   * 
   * @param parameters - The execution parameters
   * @returns The language model to use, or undefined for default
   */
  public getModel(_parameters: TParameters, _input: TInput, overrides: Record<string, Model | string>): Model {
    return getModelConfig(this.name, undefined, overrides);
  }
  
  /**
   * Gets the system prompt for this agent.
   * This defines the agent's behavior and capabilities.
   * 
   * @param parameters - The execution parameters
   * @returns The system prompt string
   */
  public abstract getSystem(parameters: TParameters, _input: TInput, _context: VoxContext<TParameters>): Promise<string>;
  
  /**
   * Gets the list of active tools for this agent execution.
   * Returns the tool names that should be available to the model.
   * 
   * @param parameters - The execution parameters
   * @returns Array of tool names that should be active, or undefined for all tools
   */
  public getActiveTools(parameters: TParameters): string[] | undefined {
    return [];
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
    if (this.requiredTools?.length) {
      // Required-tools mode: stop when any required tool succeeds
      if (allSteps.some(step =>
        step.toolResults.some(r => this.requiredTools!.includes(r.toolName) && r.output)
      )) return true;
    } else {
      // Default mode: stop on empty responses or terminal-only calls
      if (lastStep.toolCalls.length === 0 && !lastStep.text?.trim()) {
        return allSteps.length >= this.maxSteps;
      }
      if (hasOnlyTerminalCalls(lastStep, context.mcpToolMap)) {
        return true;
      }
    }
    return allSteps.length >= this.maxSteps;
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
        ? finalText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '')
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
      toolChoice?: string;
      activeTools?: string[];
      messages?: ModelMessage[];
      outputSchema?: ZodObject;
    } = {};

    // Check for removeUsedTools option
    if (this.removeUsedTools) {
      // Get all tools that have been successfully used so far
      const usedToolNames = new Set<string>();
      for (const step of allSteps) {
        for (const toolResult of step.toolResults) {
          const output = toolResult.output;
          const isError = output != null && typeof output === 'object' && 'isError' in output && (output as Record<string, unknown>).isError === true;
          if (!isError) {
            usedToolNames.add(toolResult.toolName);
          }
        }
      }

      // Filter out used tools from active tools
      const currentActiveTools = this.getActiveTools(parameters);
      if (currentActiveTools && usedToolNames.size > 0) {
        config.activeTools = currentActiveTools.filter(
          toolName => !usedToolNames.has(toolName)
        );
      }
    }

    // Handle messages
    const toolChoice = config.toolChoice || this.toolChoice;
    if (lastStep === null) {
      config.messages = [...messages];
    } else if (lastStep.toolCalls.length === 0 && (toolChoice === "required" || toolChoice === "tool" || !lastStep.text?.trim())) {
      // Empty response rescue: no tool calls and no text: strip response and prompt to retry
      const baseMessages = config.messages || messages;
      const responseMessages = lastStep.response.messages;
      const cleaned = baseMessages.filter(
        msg => !responseMessages.some(respMsg => respMsg === msg)
      );
      const rescue = buildRescuePrompt(toolChoice);
      if (cleaned[cleaned.length - 1]?.content !== rescue)
        cleaned.push({ role: 'user', content: rescue });
      config.messages = cleaned;
    } else if (this.onlyLastRound) {
      // Keep all system and user messages, but only the last round of assistant/tool messages
      const filteredMessages: ModelMessage[] = [];
      let lastUserIndex = -1;

      // Pass 1: keep all system and user messages
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        filteredMessages.push(message);
        lastUserIndex = i;
        if (message.role !== 'system' && message.role !== 'user')
          break;
      }

      // Pass 2: find the start of the last assistant round, then add it in order
      let roundStart = messages.length;
      for (let i = messages.length - 1; i > lastUserIndex; i--) {
        roundStart = i;
        if (messages[i].role === "assistant") break;
      }
      for (let i = roundStart; i < messages.length; i++)
        filteredMessages.push(messages[i]);

      config.messages = filteredMessages;
    }

    // Inject continuation nudge when loop continues past first step
    if (this.continuationNudge && allSteps.length > 0) {
      const nudge = this.continuationNudge(parameters);
      const msgs = config.messages || messages;
      if (msgs[msgs.length - 1]?.content !== nudge) {
        config.messages = [...msgs, { role: 'user', content: nudge }];
      }
    }

    config.model = this.getModel(parameters, input, context.modelOverrides);

    return config;
  }
}