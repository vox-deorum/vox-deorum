/**
 * @module infra/vox-run
 *
 * Type definitions for the VoxContext run model: the public run options/handle exposed to
 * callers, the per-execution token output, and the internal root-run / execution-frame shapes
 * used to support concurrent root runs on one context. See {@link VoxContext} for the runtime.
 */

import { v4 as uuidv4 } from 'uuid';
import type { AgentParameters } from "./vox-agent.js";

/** Mutable object populated by execute() with per-execution token counts. */
export interface ExecuteTokenOutput {
  inputTokens: number;
  reasoningTokens: number;
  outputTokens: number;
}

/** Optional controls for a single agent execution. */
export interface ExecuteOptions {
  /** Re-throw non-context-length agent errors after recording telemetry. */
  throwOnError?: boolean;
}

/** Options for opening a root run via VoxContext.withRun. */
export interface VoxRunOptions<TParameters> {
  /** Parameter source for the run; defaults to the context's baseParameters when omitted. */
  parameters?: TParameters;
  /** Run-local top-level parameter overrides (e.g. turn/before/after) overlaid on the source. */
  overrides?: Partial<TParameters>;
  /** Run-local progress callback (e.g. an SSE writer). */
  streamProgress?: (message: string) => void;
}

/** Handle to a single root run, passed to the run callback so HTTP/SSE code can cancel it. */
export interface VoxRunHandle<TParameters> {
  /** Unique identifier for this run. */
  readonly id: string;
  /** The run's composed parameters (override overlay on the source). */
  readonly parameters: TParameters;
  /** The run's abort signal; all model calls in the run observe it. */
  readonly signal: AbortSignal;
  /** Cumulative token counts for every execution nested in the run. */
  readonly tokens: ExecuteTokenOutput;
  /** Cancel this run and everything synchronously nested in it. */
  abort(): void;
}

/**
 * A root run: the unit of concurrent work on a VoxContext. Owns one cancellation scope, the
 * run-local progress callback, a cumulative token sink, and the composed parameters.
 *
 * @internal
 */
export interface RootRun<TParameters extends AgentParameters> {
  readonly id: string;
  /** Composed parameter view (override overlay on the source, or a plain object for forks). */
  readonly parameters: TParameters;
  readonly abortController: AbortController;
  /** Run-local progress callback (the whole operation's progress sink, shared by nested agents). */
  streamProgress?: (message: string) => void;
  /** Cumulative tokens for all executions nested in this run. */
  readonly tokens: ExecuteTokenOutput;
  /** Set once the run callback settles; makes abort/cleanup idempotent. */
  settled: boolean;
}

/**
 * An execution frame: the active root, the current agent input, and the current execution's
 * timeout-refresh slot. Nested executes nest frames. `timeoutRefresh` is per-frame (not per-root)
 * because each `execute()` runs its own model stream: the concurrency wrapper rebinds it per model
 * call and MCP tools read it from the same frame, so concurrent sibling executions sharing one root
 * never refresh one another's timeout and a nested execution restores the parent's slot on return.
 *
 * @internal
 */
export interface ExecutionFrame<TParameters extends AgentParameters> {
  readonly root: RootRun<TParameters>;
  readonly input: unknown;
  /** Per-execution timeout-refresh callback, rebound per model call by the concurrency wrapper. */
  timeoutRefresh: () => void;
}

// ===========================================================================================
// Run construction helpers
//
// Pure factories for the run model, kept here (not on VoxContext) because they touch only their
// arguments — no context instance state. VoxContext composes them with its AsyncLocalStorage
// store, active-run map, and lifecycle.
// ===========================================================================================

/**
 * Compose a run's parameter view: an override overlay on a base source. Override keys (typically
 * `turn`/`before`/`after`) read and write a run-local object; every other property reads and
 * writes the base, so nested shared objects (gameStates, workingMemory, metadata) keep their
 * original references and seat-wide primitives (e.g. `lastDecisionTurn`) resolve to the base.
 * Returns the source unchanged when there are no overrides (no proxy needed).
 *
 * NOTE on seat-wide writes: because non-override keys write through to the base, a base write is
 * visible to every concurrent run on the seat. Only the strategist root writes `lastDecisionTurn`;
 * a chat root must never write it. A forked child instead holds a snapshot copy of these
 * primitives (see {@link forkSnapshotParameters}), so the seat-wide guarantee applies only to
 * proxy (withRun) roots — a forked analyst's top-level write stays local and must not be relied on.
 */
export function composeParameters<TParameters extends AgentParameters>(
  base: TParameters,
  overrides?: Partial<TParameters>
): TParameters {
  if (!overrides || Object.keys(overrides).length === 0) return base;
  const override: Record<string | symbol, unknown> = { ...overrides };

  return new Proxy(base as object, {
    get(target, prop, receiver) {
      if (prop in override) return override[prop];
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      if (prop in override) { override[prop] = value; return true; }
      return Reflect.set(target, prop, value, receiver);
    },
    has(target, prop) {
      return prop in override || Reflect.has(target, prop);
    },
    // The planned override keys also exist on the base, so base enumeration already covers them;
    // these traps keep enumeration/spread correct even if an override-only key is added.
    ownKeys(target) {
      return Array.from(new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(override)]));
    },
    getOwnPropertyDescriptor(target, prop) {
      if (prop in override) {
        return { configurable: true, enumerable: true, writable: true, value: override[prop] };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    }
  }) as TParameters;
}

/**
 * Shallow-copy a run's composed parameters into a new plain object for a detached fork. Spreading
 * the composed view materializes top-level overrides+base values by value while leaving nested
 * objects (gameStates/workingMemory/metadata) as shared references. Later top-level writes in the
 * fork or its parent do not affect each other; the copy is borrowed and never closed by the fork.
 */
export function forkSnapshotParameters<TParameters extends AgentParameters>(
  parameters: TParameters
): TParameters {
  return { ...parameters } as TParameters;
}

/** Build a fresh root run over a parameter source. */
export function createRootRun<TParameters extends AgentParameters>(
  source: TParameters,
  options: VoxRunOptions<TParameters>
): RootRun<TParameters> {
  return {
    id: uuidv4(),
    parameters: composeParameters(source, options.overrides),
    abortController: new AbortController(),
    streamProgress: options.streamProgress,
    tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
    settled: false,
  };
}

/** Build an execution frame for a root + input, with a fresh per-execution timeout-refresh slot. */
export function createExecutionFrame<TParameters extends AgentParameters>(
  root: RootRun<TParameters>,
  input: unknown
): ExecutionFrame<TParameters> {
  return { root, input, timeoutRefresh: () => {} };
}

/** Abort one root run (idempotent). */
export function abortRun<TParameters extends AgentParameters>(run: RootRun<TParameters>): void {
  if (run.abortController.signal.aborted) return;
  run.abortController.abort();
}

/** Build the caller-facing handle for a root run. */
export function createRunHandle<TParameters extends AgentParameters>(
  run: RootRun<TParameters>
): VoxRunHandle<TParameters> {
  return {
    id: run.id,
    parameters: run.parameters,
    signal: run.abortController.signal,
    tokens: run.tokens,
    abort: () => abortRun(run),
  };
}
