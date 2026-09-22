/**
 * @module infra/vox-telemetry
 *
 * Telemetry primitives shared by the execution modules (vox-execute.ts and vox-evaluate.ts):
 * opening a span under the active run with the standard context/turn/agent attributes, recording
 * an error on a span, accruing token usage to the active root's sink plus the seat-wide totals
 * and an optional per-execution output, and the in-game model label update via set-metadata.
 *
 * These helpers need only a handful of things from the context, so they take the narrow
 * {@link ExecutionHost} surface rather than a VoxContext. That keeps them unit-testable against a
 * small fake and keeps this module free of any import from vox-context.ts.
 */

import { SpanStatusCode } from '@opentelemetry/api';
import type { Span, Tracer } from '@opentelemetry/api';
import type { AgentParameters } from "./vox-agent.js";
import type { Model } from "../types/index.js";
import type { ExecuteTokenOutput, RootRun } from "./vox-run.js";

/**
 * Everything the telemetry helpers read or write on the context: the tracer and context id that
 * stamp every span, the seat-wide token totals, and the label state plus tool-call path the model
 * label update needs. VoxContext implements it, and it is deliberately no wider than that. The
 * agent loop in vox-execute.ts works against the full VoxContext instead, because the agent
 * lifecycle hooks it calls are declared to receive one.
 *
 * @template TParameters - The type of parameters the context's agents receive
 */
export interface ExecutionHost<TParameters extends AgentParameters> {
  /** Unique identifier for this context, stamped onto every span. */
  readonly id: string;

  /** The 'vox-agents' tracer the execution modules open their spans on. */
  tracer: Tracer;

  /** Total input tokens (seat-wide, across all runs). Written by token accrual. */
  inputTokens: number;
  /** Total reasoning tokens (seat-wide, across all runs). Written by token accrual. */
  reasoningTokens: number;
  /** Total output tokens (seat-wide, across all runs). Written by token accrual. */
  outputTokens: number;

  /** Last model short name sent via set-metadata, so {@link updateModelLabel} can dedupe repeat sends. */
  lastModelName?: string;

  /** Invoke a registered tool by name (the set-metadata label update calls through this). */
  callTool<T = unknown>(name: string, args: Record<string, unknown>, parameters: TParameters): Promise<T | undefined>;
}

/**
 * Open the top-level span for one agent execution, carrying the standard context id, game turn,
 * agent name, and serialized input attributes. The caller parents its work under the span with
 * `context.with(trace.setSpan(...))` and ends it itself.
 *
 * @param host - The execution host providing the tracer and context id
 * @param agentName - The agent being executed (names the span and fills agent.name)
 * @param turn - The active run's game turn (stringified into game.turn)
 * @param input - The agent input, JSON-stringified into agent.input when truthy
 * @returns The started span (not yet activated in the context)
 */
export function openAgentSpan<TParameters extends AgentParameters>(
  host: ExecutionHost<TParameters>,
  agentName: string,
  turn: number,
  input: unknown
): Span {
  return host.tracer.startSpan(`agent.${agentName}`, {
    attributes: {
      'vox.context.id': host.id,
      'game.turn': String(turn),
      'agent.name': agentName,
      'agent.input': input ? JSON.stringify(input) : undefined
    }
  });
}

/**
 * Open the span for one model step of an agent execution, carrying the standard context id, game
 * turn, and agent name attributes plus the 1-based step number.
 *
 * @param host - The execution host providing the tracer and context id
 * @param agentName - The agent being executed (names the span and fills agent.name)
 * @param turn - The active run's game turn (stringified into game.turn)
 * @param stepNumber - The 1-based step number within the execution
 * @returns The started span (not yet activated in the context)
 */
export function openStepSpan<TParameters extends AgentParameters>(
  host: ExecutionHost<TParameters>,
  agentName: string,
  turn: number,
  stepNumber: number
): Span {
  return host.tracer.startSpan(`agent.${agentName}.step.${stepNumber}`, {
    attributes: {
      'vox.context.id': host.id,
      'game.turn': String(turn),
      'agent.name': agentName,
      'step.number': stepNumber
    }
  });
}

/**
 * Record an exception on a span and mark it errored with the error message. The span is not
 * ended here: callers end it in their own `finally` so a re-throw still closes it.
 *
 * @param span - The span to fault
 * @param error - The caught error (stringified when it is not an Error instance)
 */
export function recordSpanError(span: Span, error: unknown): void {
  span.recordException(error as Error);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error)
  });
}

/**
 * Accrue one execution's token usage to the active root's sink, the seat-wide totals, and the
 * optional per-execution {@link ExecuteTokenOutput} the caller supplied.
 *
 * @param host - The execution host owning the seat-wide totals
 * @param root - The active root run whose sink absorbs the counts
 * @param usage - The token counts summed across the execution's steps
 * @param tokenOutput - Optional mutable object populated with this execution's counts
 */
export function accrueTokens<TParameters extends AgentParameters>(
  host: ExecutionHost<TParameters>,
  root: RootRun<TParameters>,
  usage: ExecuteTokenOutput,
  tokenOutput?: ExecuteTokenOutput
): void {
  root.tokens.inputTokens += usage.inputTokens;
  root.tokens.reasoningTokens += usage.reasoningTokens;
  root.tokens.outputTokens += usage.outputTokens;
  host.inputTokens += usage.inputTokens;
  host.reasoningTokens += usage.reasoningTokens;
  host.outputTokens += usage.outputTokens;

  // Populate optional token output for callers that need per-execution counts
  if (tokenOutput) {
    tokenOutput.inputTokens = usage.inputTokens;
    tokenOutput.reasoningTokens = usage.reasoningTokens;
    tokenOutput.outputTokens = usage.outputTokens;
  }
}

/**
 * Auto-send the model name to the game via set-metadata when the strategist's model changes.
 * Only agents whose name includes "-strategist" report; the value is the LLM short name, or
 * "VPAI" when there is no system prompt (in-game AI only). A dedupe against the host's
 * lastModelName keeps repeat executions on the same model from re-sending the label.
 *
 * @param host - The execution host providing lastModelName state and the callTool path
 * @param agentName - The agent being executed (checked for the "-strategist" suffix marker)
 * @param modelConfig - The resolved model configuration for this execution
 * @param system - The composed system prompt (empty selects the "VPAI" label)
 * @param parameters - The active run's parameters (supplies the playerID metadata key)
 */
export async function updateModelLabel<TParameters extends AgentParameters>(
  host: ExecutionHost<TParameters>,
  agentName: string,
  modelConfig: Model,
  system: string,
  parameters: TParameters
): Promise<void> {
  if (agentName.includes("-strategist")) {
    // "VPAI" when no system prompt (in-game AI only), otherwise the LLM short name
    const shortName = system !== ""
      ? (modelConfig.name.split("/").pop() || modelConfig.name)
      : "VPAI";
    if (shortName !== host.lastModelName) {
      host.lastModelName = shortName;
      await host.callTool("set-metadata", {
        Key: `model-${parameters.playerID}`, Value: shortName
      }, parameters);
    }
  }
}
