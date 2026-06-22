/**
 * @module tests/helpers/fake-vox-context
 *
 * A spyable stand-in for {@link VoxContext}, the runtime an agent's lifecycle hooks
 * (`getSystem`/`getInitialMessages`/`getOutput`/`prepareStep`) receive. Agents reach the
 * outside world through a small surface on the context — `callTool` (MCP tools),
 * `callAgent`/`execute` (nested agents), and a few fields (`modelOverrides`, `mcpToolMap`,
 * `logger`, `streamProgress`, `currentInput`). This fixture reproduces that surface with
 * programmable handlers and call recording so prompt builders and pipeline helpers can be
 * unit-tested without a live game, MCP server, or model.
 *
 * It is the context-level companion to {@link file://./mock-mcp-client.ts mock-mcp-client}:
 * use the MCP mock when the code under test imports the `mcpClient` singleton directly, and
 * this fixture when it calls tools/agents through a `VoxContext` handle.
 *
 * ## Usage
 *
 * ```ts
 * import { createFakeVoxContext, makeStrategistParameters } from '../../helpers/fake-vox-context.js';
 *
 * const ctx = createFakeVoxContext();
 * ctx.respondWith('search-database', { Library: { Relevance: 0.9 } });
 *
 * const params = makeStrategistParameters({ turn: 7 });
 * const out = await agent.getOutput(params, ['ctx'], finalText, ctx.asContext());
 *
 * expect(ctx.calls('search-database')[0].args).toEqual({ Keywords: ['x'], MaxResults: 10 });
 * ```
 *
 * `callTool` mirrors production semantics: an unregistered tool, or a handler that throws,
 * resolves to `undefined` (the real `VoxContext.callTool` swallows tool errors and returns
 * `undefined`). Use `respondWith(name, errorResult(...))` to exercise error-envelope paths.
 * `callAgent`/`execute` are plain `vi.fn()` spies — program them per-test with
 * `mockResolvedValue`/`mockRejectedValue`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { vi } from 'vitest';
import { Tool } from 'ai';
import { composeParameters } from '../../src/infra/vox-run.js';
import { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import type { VoxContext } from '../../src/infra/vox-context.js';
import type { GameState, StrategistParameters } from '../../src/strategist/strategy-parameters.js';
import type { Model } from '../../src/types/index.js';

/** A registered per-tool handler: receives the call args + parameters, returns (or throws) a result. */
export type FakeToolHandler = (
  args: Record<string, unknown>,
  parameters: unknown
) => unknown;

/** One recorded `callTool` invocation. */
export interface RecordedToolCall {
  name: string;
  args: Record<string, unknown>;
  parameters: unknown;
}

/**
 * Hand-written stand-in for {@link VoxContext}. Mirrors the surface that agent lifecycle
 * hooks and pipeline helpers touch, plus a programmable tool registry and call log for
 * assertions. Cast to a real `VoxContext` via {@link asContext}.
 */
export class FakeVoxContext {
  private handlers = new Map<string, FakeToolHandler>();

  /** Stable id, mirroring `VoxContext.id`. */
  public readonly id: string;

  /** Model configuration overrides, consulted by `getModel` implementations. */
  public modelOverrides: Record<string, Model | string> = {};

  /** Raw MCP tool metadata map, used for annotation/markdown lookups. */
  public mcpToolMap: Map<string, MCPTool> = new Map();

  /** Registered AI SDK tools (rarely read by prompt builders; present for completeness). */
  public tools: Record<string, Tool> = {};

  /** The input of the currently-executing agent (e.g. the active EnvoyThread). */
  public currentInput?: unknown;

  /** The context-owned base parameters (set via {@link setBaseParameters}). */
  private _baseParameters?: unknown;

  /** Progress callback set outside a run (mirrors VoxContext's context-field fallback). */
  private _streamProgress?: (message: string) => void;

  /**
   * Per-run execution state, reached through {@link AsyncLocalStorage} exactly like the real
   * VoxContext — so concurrent runs are genuinely isolated rather than overwriting shared fields.
   */
  private _als = new AsyncLocalStorage<{
    parameters: unknown;
    streamProgress?: (message: string) => void;
  }>();

  /** Monotonic id source for fake run handles. */
  private _runCounter = 0;

  /** Silent logger stand-in — agents call `this.logger`, contexts expose `.logger`. */
  public logger = (() => {
    const base: any = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    // `.child()` returns the same logger so child-logger call sites are recorded alongside it.
    base.child = vi.fn(() => base);
    return base;
  })();

  /**
   * The active run's composed parameters, falling back to the base outside a run — mirrors
   * `VoxContext.currentParameters`. Resolved from ALS so concurrent runs each see their own.
   */
  get currentParameters(): unknown {
    return this._als.getStore()?.parameters ?? this._baseParameters;
  }

  /**
   * Non-LLM progress callback. Inside a run it resolves to that run's callback (ALS-backed);
   * outside a run it falls back to the field, which tests set directly via the setter.
   */
  get streamProgress(): ((message: string) => void) | undefined {
    const store = this._als.getStore();
    return store ? store.streamProgress : this._streamProgress;
  }
  set streamProgress(callback: ((message: string) => void) | undefined) {
    this._streamProgress = callback;
  }

  /** The context-owned base parameters. */
  getBaseParameters(): unknown {
    return this._baseParameters;
  }

  /** Transfer parameter ownership to the (fake) context. */
  setBaseParameters(parameters: unknown): void {
    this._baseParameters = parameters;
  }

  /**
   * Run-model fake: compose `overrides` over the run's parameter source (option `parameters` or
   * the base), run the callback inside an ALS scope carrying the composed parameters + run-local
   * `streamProgress`, and yield a handle with an observable `abort`. Because the per-run state
   * lives in AsyncLocalStorage (not shared fields), concurrent runs observe their own
   * `currentParameters`/`streamProgress` — matching production isolation. The composed parameters
   * are also exposed on the handle, so code reading `run.parameters` works as in production.
   *
   * Composition uses the real {@link composeParameters} proxy (not a shallow copy), so override
   * keys stay run-local while writes to *non-override* top-level fields go through to the base —
   * seat-wide, exactly as in production — instead of being silently kept local (which would mask
   * state-sharing bugs).
   */
  withRun = vi.fn(
    async (
      options: {
        parameters?: unknown;
        overrides?: Record<string, unknown>;
        streamProgress?: (message: string) => void;
      },
      callback: (run: {
        id: string;
        parameters: unknown;
        signal: AbortSignal;
        tokens: { inputTokens: number; reasoningTokens: number; outputTokens: number };
        abort: () => void;
      }) => Promise<unknown>
    ): Promise<unknown> => {
      const source = options?.parameters ?? this._baseParameters;
      // With a source present, build the same override-overlay proxy production uses; tolerate a
      // missing source (no params/base) by falling back to an overrides-only object.
      const composed =
        source !== undefined
          ? composeParameters(source as any, options?.overrides as any)
          : { ...(options?.overrides ?? {}) };
      const aborter = new AbortController();
      const handle = {
        id: `fake-run-${this._runCounter++}`,
        parameters: composed,
        signal: aborter.signal,
        tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
        abort: vi.fn(() => aborter.abort()),
      };
      // Run-local streamProgress: the option when provided, otherwise inherit the ambient value.
      const streamProgress =
        options && 'streamProgress' in options ? options.streamProgress : this.streamProgress;
      return this._als.run({ parameters: composed, streamProgress }, () => callback(handle));
    }
  );

  /** Every `callTool` invocation, in order. */
  public callLog: RecordedToolCall[] = [];

  constructor(id = 'fake-vox-context') {
    this.id = id;
  }

  /**
   * Dispatch to a registered handler; record the call. Mirrors production: an unknown tool
   * or a throwing handler resolves to `undefined` rather than rejecting.
   */
  callTool = vi.fn(
    async <T = unknown>(
      name: string,
      args: Record<string, unknown>,
      parameters: unknown
    ): Promise<T | undefined> => {
      this.callLog.push({ name, args, parameters });
      const handler = this.handlers.get(name);
      if (!handler) return undefined;
      try {
        return (await handler(args, parameters)) as T;
      } catch {
        return undefined;
      }
    }
  );

  /** Nested-agent invocation spy (used by e.g. Summarizer.summarizeWithCache). */
  callAgent = vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined);

  /** Direct agent-execution spy (used by the agent-tool wrapper). */
  execute = vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined);

  /**
   * Detached-run spy (used by the agent-tool wrapper for fire-and-forget). Invokes the callback
   * with a minimal run handle and swallows rejections, mirroring `VoxContext.forkRun` so the
   * detached `execute()` still runs (and failures don't reject the caller).
   */
  forkRun = vi.fn((callback: (run: unknown) => Promise<unknown>): void => {
    const run = {
      id: 'fake-fork-run',
      parameters: {},
      signal: new AbortController().signal,
      tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
      abort: () => {},
    };
    void Promise.resolve(callback(run)).catch(() => {});
  });

  // ---- controller helpers (test-facing) ----

  /** Register a handler for `name`. The handler may return a result or throw. */
  onTool(name: string, handler: FakeToolHandler): this {
    this.handlers.set(name, handler);
    return this;
  }

  /** Register a constant result for `name`. */
  respondWith(name: string, value: unknown): this {
    return this.onTool(name, () => value);
  }

  /** Register `name` to throw (callTool will then resolve `undefined`, as in production). */
  failWith(name: string, error: Error | string): this {
    const err = typeof error === 'string' ? new Error(error) : error;
    return this.onTool(name, () => {
      throw err;
    });
  }

  /** Recorded calls, optionally filtered to a single tool name. */
  calls(name?: string): RecordedToolCall[] {
    return name ? this.callLog.filter((c) => c.name === name) : this.callLog;
  }

  /** Set the raw MCP tool metadata map (for `_meta`/markdown lookups). */
  setMcpTools(tools: MCPTool[]): this {
    this.mcpToolMap = new Map(tools.map((t) => [t.name, t]));
    return this;
  }

  /** Clear handlers, recorded calls, and spy history. */
  reset(): void {
    this.handlers.clear();
    this.callLog = [];
    this.callTool.mockClear();
    this.callAgent.mockClear();
    this.execute.mockClear();
    this.forkRun.mockClear();
    this.withRun.mockClear();
    this.logger.info.mockClear();
    this.logger.warn.mockClear();
    this.logger.error.mockClear();
    this.logger.debug.mockClear();
  }

  /** Narrow this fixture to the `VoxContext` type expected by code under test. */
  asContext<TParameters extends StrategistParameters = StrategistParameters>(): VoxContext<TParameters> {
    return this as unknown as VoxContext<TParameters>;
  }
}

/** Construct a fresh fake context. Call in each test (or `beforeEach`). */
export function createFakeVoxContext(id?: string): FakeVoxContext {
  return new FakeVoxContext(id);
}

/**
 * Build a complete {@link StrategistParameters} with sensible defaults (Rome / Caesar,
 * player 1, turn 5, empty memory/state). Pass `overrides` to vary individual fields.
 */
export function makeStrategistParameters(
  overrides: Partial<StrategistParameters> = {}
): StrategistParameters {
  return {
    playerID: 1,
    gameID: 'test-game',
    turn: 5,
    after: 0,
    before: 0,
    workingMemory: {},
    gameStates: {},
    mode: 'Flavor',
    metadata: {
      YouAre: { Name: 'Rome', Leader: 'Caesar' },
    } as StrategistParameters['metadata'],
    ...overrides,
  } as StrategistParameters;
}

/** Build a minimal {@link GameState} for `turn` with optional report/field overrides. */
export function makeGameState(
  turn: number,
  overrides: Partial<GameState> = {}
): GameState {
  return {
    turn,
    reports: {},
    ...overrides,
  } as GameState;
}
