/**
 * @module infra/vox-context
 *
 * Runtime context for executing Vox Agents.
 * Manages agent registration, tool availability, and agent execution with observability.
 * The agentic loop itself lives in vox-execute.ts, its shared telemetry primitives in
 * vox-telemetry.ts, and the single-call evaluation path in vox-evaluate.ts; execute() and
 * evaluate() here are thin delegators that pass the context itself as the host.
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

import { Tool } from "ai";
import type { Experimental_EvaluationQuestion, Experimental_EvaluationResult } from "ai";
import { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import { AgentParameters, VoxAgent } from "./vox-agent.js";
import type { TriageDecision } from "./vox-agent.js";
import { createLogger } from "../utils/logger.js";
import { mcpClient } from "../utils/models/mcp-client.js";
import { Model, StreamingEventCallback, TriageSetting } from "../types/index.js";
import { v4 as uuidv4 } from 'uuid';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { trace } from '@opentelemetry/api';
import { spanProcessor } from '../instrumentation.js';
import { VoxSpanExporter } from '../utils/telemetry/vox-exporter.js';
import { agentRegistry } from "./agent-registry.js";
import { contextRegistry } from "./context-registry.js";
import type { VoxSession } from "./vox-session.js";
import { createAgentTool } from "../utils/tools/agent-tools.js";
import { wrapMCPTools } from "../utils/tools/mcp-tools.js";
import { executeAgent } from "./vox-execute.js";
import { evaluateOn } from "./vox-evaluate.js";
import type { EvaluateOptions } from "./vox-evaluate.js";
import type { ExecutionHost } from "./vox-telemetry.js";
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
export class VoxContext<TParameters extends AgentParameters> implements ExecutionHost<TParameters> {
  public logger: winston.Logger;
  /** Tracer for agent and step spans, opened by the execution modules. */
  public tracer = trace.getTracer('vox-agents');

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
   * Which agents triage in this context. Only strategist seat contexts set it (see
   * `resolveSeatTriage`); every other context leaves triage off.
   */
  public triage: TriageSetting = false;

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
   * Tracks the last model short name sent via set-metadata, to avoid duplicate updates.
   * Read and written by the model label update in vox-telemetry.ts.
   */
  public lastModelName?: string;

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

  /** Name of the agent currently executing, if this run is inside an agent frame. */
  public get currentAgentName(): string | undefined {
    return this.als.getStore()?.agentName;
  }

  /**
   * The triage decision for the active execution frame, or undefined outside an execution. The
   * execution loop records it before model selection; hooks only read it.
   */
  public get currentTriage(): TriageDecision | undefined {
    return this.als.getStore()?.triage;
  }

  /**
   * Load a value once for the active execution and share it with the execution's other hooks, such
   * as triage, context building, and prepareStep reading the same durable state. Nested executions
   * get their own cache. A rejected load is dropped so a later hook can retry it. Outside a run the
   * value is loaded directly.
   *
   * @param key - Name of the cached value within the execution
   * @param load - Loads the value on first use
   */
  public memoizeForExecution<T>(key: string, load: () => Promise<T>): Promise<T> {
    const memo = this.als.getStore()?.memo;
    if (!memo) return load();
    const cached = memo.get(key);
    if (cached) return cached as Promise<T>;
    const loaded = load();
    memo.set(key, loaded);
    loaded.catch(() => memo.delete(key));
    return loaded;
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
    const mcpTools = wrapMCPTools(rawMcpTools, this);

    for (const tool of Object.keys(mcpTools)) {
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

  /**
   * The active root run, or undefined outside a run. Read by the execution loop, which needs the
   * run's composed parameters and its token sink. Code that only wants the parameters should read
   * {@link currentParameters} instead.
   */
  public get activeRoot(): RootRun<TParameters> | undefined {
    return this.als.getStore()?.root;
  }

  /**
   * Run a callback in a child execution frame over the active root, so a nested agent sees its own
   * input while inheriting the root's cancellation, parameters, and token sink. The frame is built
   * here from the active root rather than accepted from the caller, so no caller can push a frame
   * belonging to some other root. The parent input is restored when the scope exits.
   *
   * @param input - The child frame's agent input
   * @param callback - The work to run inside the child frame, handed the frame it owns
   * @param agentName - The name of the agent owning this frame
   * @throws Error when there is no active run
   */
  public runInChildFrame<TResult>(
    input: unknown,
    callback: (frame: ExecutionFrame<TParameters>) => Promise<TResult>,
    agentName: string,
  ): Promise<TResult> {
    const parent = this.als.getStore();
    if (!parent) throw new Error('VoxContext: no active run.');
    const frame = createExecutionFrame(parent.root, input, agentName);
    return this.als.run(frame, () => callback(frame));
  }

  /**
   * The active root's abort signal. Throws when called outside a run (a programming error).
   * Read by the execution loop when it hands a signal to a model call.
   */
  public currentSignal(): AbortSignal {
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
   * @param parameters - Agent parameters to pass to the tool context
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
        context: parameters
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
   * Thin delegator to {@link executeAgent} in infra/vox-execute.js, which holds the agentic loop:
   * frame push, model resolution, prompt assembly, step execution, stop checks, and output
   * conversion.
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
    return executeAgent(this, agentName, input, callback, tokenOutput, onContextLengthError, options);
  }

  /**
   * Run one evaluation call against a model. Thin delegator to {@link evaluateOn} in
   * infra/vox-evaluate.js, the single-call evaluation path that runs under this context's
   * telemetry alongside {@link execute}. Requires an active root run (rejecting otherwise).
   * Answers, confidence (from provider metadata when present), and usage land on an `evaluate`
   * span, and usage accrues to the active root's sink, the seat-wide totals, and the optional
   * per-call token output on the options.
   *
   * @param model - The model configuration to evaluate with
   * @param state - The state under evaluation (coerced to JSON for the provider contract)
   * @param options - Evaluation options (question set and optional per-call token output)
   * @returns The provider's full evaluation result (typed answers, usage, and metadata)
   * @throws Error if called outside a run, or if the evaluation call fails
   */
  public async evaluate<TQuestions extends Record<string, Experimental_EvaluationQuestion>>(
    model: Model,
    state: unknown,
    options: EvaluateOptions<TQuestions>
  ): Promise<Experimental_EvaluationResult<TQuestions>> {
    return evaluateOn(this, model, state, options);
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
