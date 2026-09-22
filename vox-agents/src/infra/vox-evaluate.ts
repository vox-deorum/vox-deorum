/**
 * @module infra/vox-evaluate
 *
 * The single-call evaluation path: one model call that scores state against questions, opened
 * under the same telemetry primitives the agent loop uses and reaching the context through the
 * narrow {@link ExecutionHost} surface. VoxContext.evaluate() delegates here. The call is not
 * implemented yet and throws unconditionally; see docs/plans/evaluation-models.md for the
 * intended design.
 */

import type { Model } from "../types/index.js";
import type { AgentParameters } from "./vox-agent.js";
import type { ExecutionHost } from "./vox-telemetry.js";

/**
 * Options for one evaluation call: the question set asked of the model and the scoring
 * controls applied to its answers.
 */
export interface EvaluateOptions {
  /** Questions to ask the evaluating model about the state. */
  questions?: unknown[];
}

/**
 * Run one evaluation call against a model: score the state against the question set under the
 * host's telemetry, sharing the run's abort signal and token sinks with the agent loop.
 *
 * Not implemented yet; throws unconditionally so no caller can depend on it silently.
 *
 * @param _host - The execution host (the calling VoxContext) the evaluation runs under
 * @param _model - The model reference to evaluate with
 * @param _state - The state under evaluation
 * @param _options - Evaluation options (question set and scoring controls)
 * @throws Error always; the evaluation call is unimplemented
 */
export async function evaluateOn<TParameters extends AgentParameters>(
  _host: ExecutionHost<TParameters>,
  _model: Model,
  _state: unknown,
  _options?: EvaluateOptions
): Promise<never> {
  throw new Error('evaluateOn is not implemented; see docs/plans/evaluation-models.md.');
}
