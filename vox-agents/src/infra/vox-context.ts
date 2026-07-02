/**
 * @module infra/vox-context
 *
 * Runtime context for executing Vox Agents.
 * Manages agent registration, tool availability, and agent execution with observability.
 * Implements the agentic loop with tool calling, step preparation, and stop conditions.
 *
 * ## Concurrent root runs
 *
 * A VoxContext represents long-lived resources and state for one seat, and must safely support
 * multiple concurrent **root runs** (a strategist turn, each diplomat chat, each deal response,
 * each detached analyst). Per-run execution state — cancellation, progress/timeout callbacks,
 * token accounting, current parameters, and current agent input — lives on a {@link RootRun}
 * object reached through an {@link AsyncLocalStorage} execution frame, never on shared instance
 * fields. Open a run with {@link VoxContext.withRun} (awaited) or {@link VoxContext.forkRun}
 * (detached); agents invoked synchronously inside a run are nested executions that inherit the
 * same root while temporarily replacing only the active input.
 */

import { Output, Tool, StepResult, ToolSet, ModelMessage } from "ai";
import { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import { AgentParameters, VoxAgent } from "./vox-agent.js";
import { createLogger } from "../utils/logger.js";
import { mcpClient } from "../utils/models/mcp-client.js";
import { getModel, buildProviderOptions } from "../utils/models/models.js";
import { Model, StreamingEventCallback } from "../types/index.js";
import { streamTextWithConcurrency, withModelConfig } from "../utils/models/concurrency.js";
import { v4 as uuidv4 } from 'uuid';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { trace, SpanStatusCode, context } from '@opentelemetry/api';
import { spanProcessor } from '../instrumentation.js';
import { VoxSpanExporter } from '../utils/telemetry/vox-exporter.js';
import { countMessagesTokens } from "../utils/models/token-counter.js";
import { emitClaudeCodeToolSpans } from "../utils/telemetry/claude-code-spans.js";
import { cleanToolArtifacts } from "../utils/models/text-cleaning.js";
import { isContextLengthError } from "../utils/retry.js";
import { agentRegistry } from "./agent-registry.js";
import { contextRegistry } from "./context-registry.js";
import type { VoxSession } from "./vox-session.js";
import { createAgentTool } from "../utils/tools/agent-tools.js";
import { wrapMCPTools } from "../utils/tools/mcp-tools.js";
import {
  forkSnapshotParameters,
  createRootRun,
  createRunHandle,
  createExecutionFrame,
  abortRun,
} from "./vox-run.js";
import type {
  ExecuteTokenOutput,
  ExecuteOptions,
  VoxRunOptions,
  VoxRunHandle,
  RootRun,
  ExecutionFrame,
} from "./vox-run.js";
import winston from "winston";

/**
 * Runtime context for executing Vox Agents.
 * Manages agent registration, tool availability, and execution flow.
 *
 * @template TParameters - The type of parameters that agents will receive
 */
export class VoxContext<TParameters extends AgentParameters> {
  public logger: winston.Logger;
  private tracer = trace.getTracer('vox-agents');

  /**
   * Unique identifier for this context instance
   */
  public readonly id: string;

  /**
   * Registry of available tools indexed by name
   */
  public tools: Record<string, Tool> = {};

  /**
   * Map of raw MCP tool definitions indexed by name, used for annotation lookups
   */
  public mcpToolMap: Map<string, MCPTool> = new Map();

  /**
   * Model configuration overrides (replaces config.json definitions)
   */
  public modelOverrides: Record<string, Model | string>;

  /**
   * Current execution frame for concurrent root runs. The store points at a {@link RootRun}
   * via an {@link ExecutionFrame}; all per-run execution state (cancellation, parameters,
   * input, progress/timeout callbacks, token sink) is reached through it rather than shared
   * instance fields.
   */
  private readonly als = new AsyncLocalStorage<ExecutionFrame<TParameters>>();

  /**
   * The stable long-lived parameter object owned by the context (the seat's base parameters).
   * Used as the parameter source for runs that don't supply their own, and closed by shutdown().
   */
  private baseParameters?: TParameters;

  /** Active root runs by id, so context-wide abort and shutdown can reach every run. */
  private readonly activeRuns = new Map<string, RootRun<TParameters>>();

  /** Set once shutdown begins; new runs are rejected. */
  private closing = false;

  /**
   * Total input tokens (seat-wide, across all runs)
   */
  public inputTokens: number = 0;
  /**
   * Total reasoning tokens (seat-wide, across all runs)
   */
  public reasoningTokens: number = 0;
  /**
   * Total output tokens (seat-wide, across all runs)
   */
  public outputTokens: number = 0;

  /**
   * Tracks the last model short name sent via set-metadata, to avoid duplicate updates
   */
  private lastModelName?: string;

  /**
   * The session that owns this context, when it was created within one (e.g. a VoxPlayer's
   * context inside a StrategistSession). Lets context consumers reach authoritative session
   * state — notably the live game turn (`session.getTurn()`) — without going through the
   * session registry. Undefined for standalone contexts (telepathist, oracle, archivist).
   */
  public session?: VoxSession;

  /**
   * The active root's composed parameters, falling back to baseParameters outside a run.
   * Non-agent tool and display code may read this outside a run (it returns the base); the
   * fallback never permits execute()/callAgent(), which require an active run.
   */
  public get currentParameters(): TParameters | undefined {
    return this.als.getStore()?.root.parameters ?? this.baseParameters;
  }

  /**
   * The input of the currently-executing agent (e.g. the EnvoyThread for a chat), read from the
   * active execution frame. A nested execute() pushes a new frame, so this naturally returns to
   * the parent input when the nested call completes. Undefined outside a run.
   */
  public get currentInput(): unknown {
    return this.als.getStore()?.input;
  }

  /**
   * Optional callback for streaming non-LLM progress updates, backed by the active root. Returns
   * undefined outside a run; the setter requires an active run and throws otherwise (callers must
   * open their run before assigning a progress sink — pass it through {@link VoxRunOptions} or set
   * it inside the run).
   */
  public get streamProgress(): ((message: string) => void) | undefined {
    return this.als.getStore()?.root.streamProgress;
  }
  public set streamProgress(callback: ((message: string) => void) | undefined) {
    const frame = this.als.getStore();
    if (!frame) throw new Error('VoxContext.streamProgress can only be set inside an active run.');
    frame.root.streamProgress = callback;
  }

  /**
   * A callback for refreshing LLM timeouts. Backed by the active execution frame (rebound per model
   * call by the concurrency wrapper, read by MCP tools), so concurrent sibling executions on one
   * root never refresh each other's timeout. Returns undefined outside a run; the setter requires
   * an active run and throws otherwise.
   */
  public get timeoutRefresh(): (() => void) | undefined {
    return this.als.getStore()?.timeoutRefresh;
  }
  public set timeoutRefresh(callback: () => void) {
    const frame = this.als.getStore();
    if (!frame) throw new Error('VoxContext.timeoutRefresh can only be set inside an active run.');
    frame.timeoutRefresh = callback;
  }

  /**
   * Resets the cached model identity so it will be re-sent on the next strategist execution.
   * Call this after crash recovery when the game has lost its Lua state.
   */
  public resetModelIdentity(): void {
    this.lastModelName = undefined;
  }

  /**
   * Constructor for VoxContext
   * @param modelOverrides - Model configuration overrides to replace config.json definitions
   * @param id - Optional context ID, generates a UUID if not provided
   */
  constructor(modelOverrides: Record<string, Model | string> = {}, id?: string) {
    this.id = id || uuidv4();
    this.modelOverrides = modelOverrides;
    this.logger = createLogger(`VoxContext-${this.id}`);
    this.logger.info(`VoxContext initialized with ID: ${this.id}`);

    // Automatically register this context in the registry
    contextRegistry.register(this);
  }

  /** Path to the MCP tool metadata cache file */
  private static readonly toolCachePath = path.join('cache', 'mcp-tools.json');

  /**
   * Register all tools.
   * Fetches available tools from the MCP server and wraps them for use with AI SDK.
   * Also registers agent tools and extra tools. Persists MCP tool metadata to disk for offline use.
   */
  public async registerTools() {
    // MCP tools
    const rawMcpTools = await mcpClient.getTools();
    this.mcpToolMap = new Map(rawMcpTools.map(t => [t.name, t]));
    var mcpTools = wrapMCPTools(rawMcpTools, this);

    for (var tool of Object.keys(mcpTools)) {
      this.tools[tool] = mcpTools[tool];
    }

    // Agent + extra tools
    this.registerAgentTools();

    // Persist MCP tool metadata for offline use
    this.saveToolCache(rawMcpTools);
  }

  /**
   * Register agent tools and agent-provided extra tools without connecting to MCP.
   * Use this together with loadToolCache() for workflows that don't need live MCP tools
   * (e.g. telepathist post-game analysis).
   */
  public registerAgentTools(): void {
    const allAgents = agentRegistry.getAllAsRecord();
    for (const [agentName, agent] of Object.entries(allAgents)) {
      // Agent as a tool
      this.tools[`call-${agentName}`] = createAgentTool(
        agent as VoxAgent<TParameters>,
        this
      );

      // Register any extra tools provided by the agent
      const extraTools = (agent as VoxAgent<TParameters>).getExtraTools(this);
      for (const [toolName, tool] of Object.entries(extraTools)) {
        this.tools[toolName] = tool;
      }
    }
  }

  /**
   * Save MCP tool definitions to a JSON cache file.
   * The full schema is needed by offline Oracle replay; metadata-only readers below
   * remain tolerant of older cache files.
   */
  private saveToolCache(tools: MCPTool[]): void {
    try {
      const cacheDir = path.dirname(VoxContext.toolCachePath);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      const cacheData = tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        _meta: t._meta
      }));
      fs.writeFileSync(VoxContext.toolCachePath, JSON.stringify(cacheData, null, 2));
      this.logger.debug(`Saved MCP tool cache (${tools.length} tools)`);
    } catch (error) {
      this.logger.warn('Failed to save MCP tool cache', { error });
    }
  }

  /**
   * Load MCP tool metadata from cache. Used when MCP server is offline (e.g. -p mode).
   * Populates mcpToolMap so formatToolOutput can find markdownConfig.
   */
  public loadToolCache(): void {
    try {
      if (!fs.existsSync(VoxContext.toolCachePath)) {
        this.logger.warn('No MCP tool cache found — formatToolOutput will use default formatting');
        return;
      }
      const raw = fs.readFileSync(VoxContext.toolCachePath, 'utf-8');
      const tools: Pick<MCPTool, 'name' | '_meta'>[] = JSON.parse(raw);
      this.mcpToolMap = new Map(tools.map(t => [t.name, t as MCPTool]));
      this.logger.info(`Loaded MCP tool cache (${tools.length} tools)`);
    } catch (error) {
      this.logger.warn('Failed to load MCP tool cache', { error });
    }
  }

  // ===========================================================================================
  // Run model
  //
  // ## Parameter ownership convention
  //
  // - `setBaseParameters()` transfers ownership to VoxContext; `shutdown()` closes
  //   `baseParameters`.
  // - Parameters supplied through `withRun({ parameters })` remain caller-owned. The caller
  //   closes them in its own `finally` when they hold resources.
  // - The shallow parameter copy created by `forkRun()` is borrowed and never closed by the
  //   fork. Its nested resource-bearing objects remain owned by their original base or caller.
  // - A caller may fork a run over caller-owned parameters only when it guarantees that the
  //   referenced resources outlive the detached child. The fire-and-forget analyst path forks
  //   base-backed seat parameters, whose lifetime is already the context lifetime.
  // - `withRun()` and `forkRun()` never infer ownership or invoke `parameters.close()`.
  // ===========================================================================================

  /**
   * Set the context's base parameters: the stable, long-lived parameter object owned by the
   * context. Used by VoxPlayer, telepathist setup, and other context owners. execute() does not
   * replace the base; shutdown() closes it.
   */
  public setBaseParameters(parameters: TParameters): void {
    this.baseParameters = parameters;
  }

  /** The context-owned base parameters, if any (seat state usable outside a run). */
  public getBaseParameters(): TParameters | undefined {
    return this.baseParameters;
  }

  // The run-construction primitives — composeParameters, forkSnapshotParameters, createRootRun,
  // createRunHandle, abortRun — live in ./vox-run.js because they touch only their arguments.
  // VoxContext composes them with its AsyncLocalStorage store, active-run map, and lifecycle.

  /**
   * Open a root run, enter its execution scope, invoke the callback, and unregister it in
   * `finally`. Covers all work belonging to the operation, including preparation before the
   * first agent executes. The callback receives the run handle so HTTP/SSE code can cancel that
   * specific operation.
   *
   * The parameter source is `options.parameters` when supplied, otherwise `baseParameters`;
   * throws before entering the run if neither exists. `options.overrides` seeds the run-local
   * side of the composed parameter proxy.
   */
  public async withRun<TResult>(
    options: VoxRunOptions<TParameters>,
    callback: (run: VoxRunHandle<TParameters>) => Promise<TResult>
  ): Promise<TResult> {
    if (this.closing) {
      throw new Error('VoxContext is shutting down; new runs are rejected.');
    }
    const source = options.parameters ?? this.baseParameters;
    if (!source) {
      throw new Error('VoxContext.withRun requires options.parameters or baseParameters set via setBaseParameters().');
    }

    const run = createRootRun(source, options);
    const handle = createRunHandle(run);
    const frame = createExecutionFrame(run, undefined);
    this.activeRuns.set(run.id, run);

    // A run opened inside another run is a *child*: it dies with its parent. Link this run's
    // cancellation to the enclosing run's signal so a parent run.abort() (e.g. an SSE disconnect)
    // cascades into nested work such as per-turn telepathist preparation. The child keeps its own
    // AbortController, so aborting one sibling never touches another — only parent→child cascades.
    // (forkRun() deliberately does NOT link: a detached analyst must survive its parent's abort.)
    let unlinkParent: (() => void) | undefined;
    const parentFrame = this.als.getStore();
    if (parentFrame) {
      const parentSignal = parentFrame.root.abortController.signal;
      if (parentSignal.aborted) {
        abortRun(run);
      } else {
        const onParentAbort = () => abortRun(run);
        parentSignal.addEventListener('abort', onParentAbort);
        // Remove the listener once this child settles so a long-lived parent signal doesn't
        // accumulate listeners across many completed children.
        unlinkParent = () => parentSignal.removeEventListener('abort', onParentAbort);
      }
    }

    try {
      return await this.als.run(frame, () => callback(handle));
    } finally {
      unlinkParent?.();
      run.settled = true;
      this.activeRuns.delete(run.id);
    }
  }

  /**
   * Start a detached root run from inside an existing run. Shallow-copies the parent's composed
   * parameters into a new plain object (top-level primitives — turn/before/after/lastDecisionTurn
   * and any other base primitive — snapshotted by value; nested seat state such as gameStates,
   * workingMemory, and metadata shared by reference), copies the progress configuration, gives
   * the child an independent cancellation/token scope, starts it without awaiting completion, and
   * logs failures. Later top-level writes in either run do not affect the other.
   *
   * Used only for `fireAndForget` agents. The detached child keeps the parent's turn and game
   * view but survives cancellation of the parent run (context-wide abort still cancels it).
   */
  public forkRun(callback: (run: VoxRunHandle<TParameters>) => Promise<unknown>): void {
    const parent = this.als.getStore();
    if (!parent) {
      throw new Error('VoxContext.forkRun must be called inside an active run.');
    }
    if (this.closing) {
      this.logger.warn('forkRun ignored: context is shutting down.');
      return;
    }

    // Snapshot the composed parent view into a plain object: top-level overrides+base values by
    // value, nested objects shared by reference. The fork is borrowed (never closed).
    const snapshot = forkSnapshotParameters(parent.root.parameters);
    const run = createRootRun(snapshot, { streamProgress: parent.root.streamProgress });
    const frame = createExecutionFrame(run, undefined);
    this.activeRuns.set(run.id, run);

    void this.als.run(frame, () => callback(createRunHandle(run)))
      .catch((error) => this.logger.error(`Forked run ${run.id} failed:`, error))
      .finally(() => {
        run.settled = true;
        this.activeRuns.delete(run.id);
      });
  }

  /** The active root's abort signal. Throws when called outside a run (a programming error). */
  private currentSignal(): AbortSignal {
    const frame = this.als.getStore();
    if (!frame) throw new Error('VoxContext: no active run.');
    return frame.root.abortController.signal;
  }

  /**
   * Cancel active root runs.
   *
   * Context-wide: aborts every active root (used by VoxPlayer.abort(), game switching, and
   * shutdown). The `successful` flag is context/player completion metadata retained for
   * VoxPlayer compatibility; it is not propagated to individual run handles.
   *
   * @param successful - Whether the abort is due to successful completion (metadata only)
   */
  public abort(successful: boolean = false): void {
    this.logger.info(`Context-wide abort (successful: ${successful}); active roots: ${this.activeRuns.size}`);
    for (const run of this.activeRuns.values()) {
      abortRun(run);
    }
  }

  /**
   * Call a tool by name with the given arguments.
   * Allows manual tool invocation outside of agent execution loop.
   *
   * Manual callTool() carries its parameter context explicitly and does not create or require a
   * root by itself — preserving setup, shutdown, and non-agent MCP calls.
   *
   * @param name - The name of the tool to call
   * @param args - The arguments to pass to the tool
   * @param parameters - Agent parameters to pass as experimental_context
   * @returns The result of the tool execution, or undefined if tool not found or execution fails
   */
  public async callTool<T = unknown>(
    name: string,
    args: Record<string, unknown>,
    parameters: TParameters): Promise<T | undefined> {
    const tool = this.tools[name];
    if (!tool) {
      this.logger.error(`Tool not found: ${name}`);
      return undefined;
    }

    try {
      const result = await tool.execute?.(args, {
        toolCallId: "manual",
        messages: [],
        experimental_context: parameters
      });
      return result;
    } catch (error) {
      this.logger.error(`Error calling tool ${name}:`, error);
      return undefined;
    }
  }

  /**
   * Call an agent by name with the given input.
   * Allows manual agent invocation outside of the main execution loop.
   * This is useful for orchestrating multiple agents or calling agents programmatically.
   *
   * Must run inside a root run; the agent's parameters come from the active root.
   *
   * @param name - The name of the agent to call
   * @param input - The input to pass to the agent
   * @returns The result of the agent execution, or undefined if agent not found or execution fails
   */
  public async callAgent<T = unknown>(
    name: string,
    input: unknown,
    onContextLengthError?: () => void): Promise<T | undefined> {
    // Check the active-run precondition before the agent-error handling below, so the missing-run
    // programming error is never swallowed into an undefined return.
    if (!this.als.getStore()) {
      throw new Error('VoxContext.callAgent requires an active run; call withRun() or forkRun().');
    }

    const agent = agentRegistry.get<TParameters>(name);
    if (!agent) {
      this.logger.error(`Agent not found: ${name}`);
      return undefined;
    }

    try {
      return await this.execute(name, input, undefined, undefined, onContextLengthError) as T;
    } catch (error) {
      this.logger.error(`Error calling agent ${name}:`, error);
      return undefined;
    }
  }

  /**
   * Execute an agent with the given parameters.
   * Runs the agent's system prompt, tools, and lifecycle hooks in an iterative loop
   * until the stop condition is met. Tracks token usage and provides observability.
   *
   * Requires an active root run (rejecting otherwise); the active root's composed parameters are
   * the single source of execution parameters. A synchronous nested agent invocation stays in the
   * current root (inheriting its cancellation, parameters, and token sink) while pushing a new
   * execution frame that replaces only the active input. Token counts accrue to the active root's
   * sink, the seat-wide totals, and the optional per-execution {@link ExecuteTokenOutput}.
   *
   * @param agentName - The name of the agent to execute
   * @param input - The agent input (becomes the new execution frame's input)
   * @returns The generated text response from the agent
   * @throws Error if called outside a run, or if the agent is not found
   */
  public async execute(
    agentName: string,
    input: unknown,
    callback?: StreamingEventCallback,
    tokenOutput?: ExecuteTokenOutput,
    onContextLengthError?: () => void,
    options: ExecuteOptions = {}
  ): Promise<unknown> {
    const frame = this.als.getStore();
    if (!frame) {
      throw new Error('VoxContext.execute requires an active run; call withRun() or forkRun().');
    }

    const agent = agentRegistry.get<TParameters>(agentName);
    if (!agent) {
      this.logger.error(`Agent not found: ${agentName}`);
      throw new Error(`Agent '${agentName}' not found in registry`);
    }

    // A diplomacy-only agent (e.g. the diplomat) has no counterpart outside a civ↔civ diplomacy
    // conversation, so it must never run as an ordinary observer/telepathist chat. This is the single
    // execution boundary every entry point — the web chat routes, the telepathist CLI, and agent-tool
    // handoffs — funnels through, so enforcing the invariant here makes it unbypassable rather than
    // relying on each caller to re-check it. The EnvoyThread `diplomacy` flag is set only by the
    // diplomacy route; non-envoy inputs (strategists, narrators) are never diplomacyOnly and skip this.
    if (agent.diplomacyOnly && !(input as { diplomacy?: boolean } | null | undefined)?.diplomacy) {
      throw new Error(`Agent '${agentName}' only runs in diplomacy mode; it cannot run as an ordinary observer/telepathist chat.`);
    }

    const root = frame.root;
    // The active root's composed parameters are the single source of execution parameters.
    const params = root.parameters;
    // Push a nested frame so a sub-agent (e.g. an agent-tool such as call-diplomatic-analyst,
    // running on this same VoxContext) sees its own input. The parent input is restored
    // automatically when this als.run scope exits, so tools that read currentInput later in the
    // parent's tool loop (e.g. close-conversation) still see the parent's EnvoyThread.
    const childFrame = createExecutionFrame(root, input);

    return this.als.run(childFrame, async () => {
      const span = this.tracer.startSpan(`agent.${agentName}`, {
        attributes: {
          'vox.context.id': this.id,
          'game.turn': String(params.turn),
          'agent.name': agentName,
          'agent.input': input ? JSON.stringify(input) : undefined
        }
      });

      return await context.with(trace.setSpan(context.active(), span), async () => {
        try {
          // Execute the agent using generateText
          // Get model config - agent's model or default, with overrides applied
          const modelConfig = agent.getModel(params, input, this.modelOverrides);
          var system = await agent.getSystem(params, input, this);

          // Auto-send model name via set-metadata when the strategist's model changes
          if (agent.name.includes("-strategist")) {
            // "VPAI" when no system prompt (in-game AI only), otherwise the LLM short name
            const shortName = system !== ""
              ? (modelConfig.name.split("/").pop() || modelConfig.name)
              : "VPAI";
            if (shortName !== this.lastModelName) {
              this.lastModelName = shortName;
              await this.callTool("set-metadata", {
                Key: `model-${params.playerID}`, Value: shortName
              }, params);
            }
          }

          if (system != "") {
            var shouldStop = false;
            var messages: ModelMessage[] = [{
              role: "system",
              content: system
            }];

            const initialMessages = await agent.getInitialMessages(params, input, this);
            messages.push(...initialMessages);
            var allSteps: StepResult<ToolSet>[] = [];
            var finalText = "";

            // Count tokens
            var inputTokens = 0;
            var reasoningTokens = 0;
            var outputTokens = 0;

            // Execute steps in a loop, one at a time
            for (let stepCount = 0; !shouldStop; stepCount++) {
              this.logger.info(`Executing ${agentName}'s step ${stepCount + 1}`, {
                GameID: params.gameID,
                PlayerID: params.playerID
              });

              // Execute the step with proper tracing
              const stepResult = await this.executeAgentStep(
                agent,
                params,
                input,
                allSteps,
                stepCount,
                messages,
                modelConfig,
                callback
              );

              // Update state from step results
              messages = stepResult.messages;
              shouldStop = stepResult.shouldStop;
              finalText = stepResult.finalText ?? "";
              inputTokens += stepResult.inputTokens;
              reasoningTokens += stepResult.reasoningTokens;
              outputTokens += stepResult.outputTokens;
            }

            this.logger.info(`Agent execution completed: ${agentName} with ${allSteps.length} steps`);

            // Accrue tokens to the active root's sink and the seat-wide totals.
            root.tokens.inputTokens += inputTokens;
            root.tokens.reasoningTokens += reasoningTokens;
            root.tokens.outputTokens += outputTokens;
            this.inputTokens += inputTokens;
            this.reasoningTokens += reasoningTokens;
            this.outputTokens += outputTokens;
            span.setAttributes({
              'model': `${modelConfig.provider}/${modelConfig.name}@${modelConfig.options?.["reasoningEffort"] ?? ""}`,
              'tokens.input': inputTokens,
              'tokens.reasoning': reasoningTokens,
              'tokens.output': outputTokens,
            });
            span.setStatus({ code: SpanStatusCode.OK });

            // Populate optional token output for callers that need per-execution counts
            if (tokenOutput) {
              tokenOutput.inputTokens = inputTokens;
              tokenOutput.reasoningTokens = reasoningTokens;
              tokenOutput.outputTokens = outputTokens;
            }

            // Convert into the output (now async)
            const output = await agent.getOutput(params, input, finalText, this);
            if (!output) return;
            return agent.postprocessOutput(params, input, output);
          } else {
            span.setStatus({ code: SpanStatusCode.OK, message: 'No system prompt' });
            return undefined;
          }
        } catch (error) {
          this.logger.error(`Error executing agent ${agentName}!`, error);
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error)
          });
          const contextLengthError = isContextLengthError(error);
          if (onContextLengthError && contextLengthError) {
            onContextLengthError();
          }
          if (options.throwOnError && !contextLengthError) {
            throw error;
          }
          return undefined;
        } finally {
          span.end();
        }
      });
    });
  }

  /**
   * Execute a single agent step with proper tracing and error handling.
   * This method encapsulates the logic for preparing, executing, and processing
   * a single step in an agent's execution flow.
   *
   * @private
   * @param agent - The agent being executed
   * @param parameters - The parameters for the agent
   * @param allSteps - All steps executed so far
   * @param messages - The current message history
   * @param model - The model identifier
   * @param stepCount - The current step number
   * @returns Updated messages, stop condition, and optional final text
   */
  private async executeAgentStep(
    agent: VoxAgent<TParameters>,
    parameters: TParameters,
    input: unknown,
    allSteps: StepResult<ToolSet>[],
    stepCount: number,
    messages: ModelMessage[],
    model: Model,
    callback?: StreamingEventCallback
  ): Promise<{ messages: ModelMessage[], shouldStop: boolean, finalText?: string, inputTokens: number, reasoningTokens: number, outputTokens: number }> {
    const stepSpan = this.tracer.startSpan(`agent.${agent.name}.step.${stepCount + 1}`, {
      attributes: {
        'vox.context.id': this.id,
        'game.turn': String(parameters.turn),
        'agent.name': agent.name,
        'step.number': stepCount + 1
      }
    });

    return await context.with(trace.setSpan(context.active(), stepSpan), async () => {
      try {
        // Prepare configuration for this step
        const stepConfig = await agent.prepareStep(parameters, input,
          allSteps.length === 0 ? null : allSteps[allSteps.length - 1], allSteps, messages, this);

        // Apply prepared configuration
        messages = stepConfig.messages || messages;
        const stepModel = stepConfig.model || model;
        const stepProviderOptions = buildProviderOptions(stepConfig.model || model);
        const stepActiveTools = stepConfig.activeTools || agent.getActiveTools(parameters);
        const stepToolChoice = stepConfig.toolChoice || (stepActiveTools && stepActiveTools.length > 0 ? agent.toolChoice : "auto");
        const stepOutputSchema = stepConfig.outputSchema;

        // Prepare tool-result messages by converting nested objects to markdown
        messages.forEach((message) => {
          if (!Array.isArray(message.content)) return;
          // Process each tool result
          message.content.forEach(toolResult => {
            if (toolResult.type === 'tool-result' && 'value' in toolResult.output && typeof(toolResult.output.value) === "object") {
              delete (toolResult.output.value as any)._markdownConfig;
            }
          });
        });

        // Record step configuration in span
        stepSpan.setAttributes({
          'step.tools': JSON.stringify(stepActiveTools),
          'step.tools.choice': stepToolChoice,
          'step.messages': JSON.stringify(messages)
        });

        // Execute a single step with concurrency limiting and retry
        // The steps are already awaited within the retry mechanism to properly catch streaming errors
        const result = await streamTextWithConcurrency(
          withModelConfig({
            // Model settings
            model: getModel(stepModel, { workingDirId: `${parameters.gameID}-${parameters.playerID}` }),
            providerOptions: stepProviderOptions,
            // Disable Vercel AI SDK's internal retry to let our wrapper handle it
            maxRetries: 0,
            // Abort signal for cancellation — the active root's signal, so aborting one root
            // never stops a sibling root's step.
            abortSignal: this.currentSignal(),
            // Current messages
            messages: messages,
            // Tools
            tools: this.tools,
            activeTools: stepActiveTools,
            toolChoice: stepModel.provider === "anthropic" && stepToolChoice === "required" ? "auto" : stepToolChoice as any,
            experimental_context: parameters,
            // Output schema for tool as agent
            experimental_output: stepOutputSchema ? Output.object({ schema: stepOutputSchema }) : undefined,
            // Stop after one step
            stopWhen: () => true,
            // Events
            onChunk: (args: any) => {
              callback?.OnChunk(args);
            }
          }, stepModel),
          this
        );

        if (!result || this.currentSignal().aborted) throw new Error("Operation aborted.");
        // Steps are already resolved by streamTextWithConcurrency
        const stepResults = result.steps;
        const stepResponse = stepResults[stepResults.length - 1];

        // Stage 3: surface CLI-executed built-in tool calls (Read/Glob/Grep/…) as
        // retrospective per-tool spans. Only claude-code steps can carry provider-
        // executed parts, so gate on the provider to keep this zero-cost elsewhere.
        if (stepModel.provider === 'claude-code') {
          const builtinToolSpans = emitClaudeCodeToolSpans(stepResponse.content, this.tracer, {
            contextId: this.id,
            turn: parameters.turn,
          });
          if (builtinToolSpans > 0) {
            this.logger.debug(`Emitted ${builtinToolSpans} claude-code built-in tool span(s) for ${agent.name} step ${stepCount + 1}`);
          }
        }

        // Update token usage
        const inputTokens = Math.max(countMessagesTokens(messages, false), stepResponse.usage.inputTokens ?? 0);
        let reasoningTokens = stepResponse.usage.reasoningTokens ?? 0;
        const outputTokens = countMessagesTokens(stepResponse.response.messages, false);

        // Alternatively: estimate reasoning tokens
        if (reasoningTokens === 0) {
          reasoningTokens = countMessagesTokens(stepResponse.response.messages, true);
          if (reasoningTokens > 0) {
            reasoningTokens = Math.max(reasoningTokens, (stepResponse.usage.outputTokens ?? 0) - outputTokens);
          }
        }

        // Record step results in span
        const responses = stepResponse.response.messages;
        responses.forEach((response: any) => delete response.providerOptions);

        // Add the step to our collection
        let shouldStop = false;
        let finalText: string | undefined;

        if (stepResults.length > 0) {
          allSteps.push(...stepResults);
          finalText = stepResponse.text;

          // Clean tool rescue artifacts from response messages
          for (const msg of stepResponse.response.messages) {
            if (Array.isArray(msg.content)) {
              msg.content = msg.content.filter((part: any) => {
                if (part.type === 'text') {
                  part.text = cleanToolArtifacts(part.text);
                  return part.text.length > 0;
                }
                return true;
              });
            } else if (typeof msg.content === 'string') {
              msg.content = cleanToolArtifacts(msg.content);
            }
          }

          // Update messages with the response
          messages = messages.concat(stepResponse.response.messages);

          // Check stop condition
          shouldStop = this.currentSignal().aborted ||
            agent.stopCheck(parameters, input, stepResponse, allSteps, this);

          this.logger.debug(`Stop check for ${agent.name}: ${shouldStop}`, {
            stepNumber: stepCount + 1,
            totalSteps: allSteps.length
          });
        } else {
          this.logger.warn(`Agent execution produced no steps: ${agent.name} at step ${stepCount + 1}.`);
          shouldStop = this.currentSignal().aborted;
        }

        stepSpan.setAttributes({
          'model': `${stepModel.provider}/${stepModel.name}@${stepModel.options?.["reasoningEffort"] ?? ""}`,
          'tokens.input': inputTokens,
          'tokens.reasoning': reasoningTokens,
          'tokens.output': outputTokens,
          'step.responses': JSON.stringify(stepResponse.response.messages)
        });

        stepSpan.setAttribute('step.should_stop', shouldStop);
        stepSpan.setStatus({ code: SpanStatusCode.OK });

        return { messages, shouldStop, finalText, inputTokens, reasoningTokens, outputTokens };
      } catch (error) {
        stepSpan.recordException(error as Error);
        stepSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error)
        });
        throw error; // Re-throw to be handled by outer try-catch
      } finally {
        stepSpan.end();
      }
    });
  }

  /**
   * Gracefully shutdown the VoxContext.
   * Marks the context as closing (rejecting new runs), aborts every active root, then flushes
   * telemetry, closes SQLite databases, closes the base parameters, and unregisters from the
   * registry.
   *
   * Shutdown needs roots to stop, not to succeed: it does not wait for them to unwind. Shutdown
   * closes only the context-owned baseParameters — run-supplied parameters stay caller-owned —
   * so there is nothing run-scoped to wait on; aborted roots settle on their own afterwards.
   */
  public async shutdown(): Promise<void> {
    this.logger.info(`Shutting down VoxContext ${this.id}`);
    this.closing = true;

    try {
      // Abort every active root (idempotent). We don't await them: shutdown closes only the
      // context-owned baseParameters below, never run-supplied parameters, so there is no
      // run-scoped resource to keep alive while a root unwinds.
      this.abort(true);

      // Force flush telemetry data to ensure all spans are written
      await spanProcessor.forceFlush();

      // Close the SQLite database for this specific context
      await VoxSpanExporter.getInstance().closeContext(this.id);

      this.logger.info(`VoxContext ${this.id} shutdown complete`);
    } catch (error) {
      this.logger.error(`Error during VoxContext shutdown for ${this.id}:`, error);
      throw error;
    } finally {
      // Resource cleanup is unconditional: release the context-owned base parameters (DB
      // connections, etc.) and unregister even if a telemetry flush above threw, so a failed
      // flush never leaks the parameters. close() runs exactly once (only here, never in the
      // try) and is guarded so its own failure still lets the unregister proceed.
      try {
        await this.baseParameters?.close?.();
      } catch (closeError) {
        this.logger.error(`Error closing base parameters for ${this.id}:`, closeError);
      }
      contextRegistry.unregister(this.id);
    }
  }
}
