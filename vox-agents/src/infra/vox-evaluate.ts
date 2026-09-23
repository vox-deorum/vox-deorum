/**
 * @module infra/vox-evaluate
 *
 * The single-call evaluation path: one model call that scores state against questions, opened
 * under the same telemetry primitives the agent loop uses and reaching the context through the
 * narrow {@link ExecutionHost} surface. VoxContext.evaluate() delegates here. The call requires
 * an active run, coerces the state into the provider contract's JSON input, runs the AI SDK's
 * `experimental_evaluate` against the factory's evaluation model with the run's abort signal,
 * and records answers, confidence (from provider metadata when present), and tokens on an
 * `evaluate` span nested under the run's active span.
 */

import { experimental_evaluate } from 'ai';
import type {
  Experimental_EvaluationQuestion as EvaluationQuestion,
  Experimental_EvaluationResult as EvaluationResult,
} from 'ai';
import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import type { Model } from "../types/index.js";
import type { AgentParameters } from "./vox-agent.js";
import type { ExecuteTokenOutput } from "./vox-run.js";
import { accrueTokens, recordSpanError } from "./vox-telemetry.js";
import type { ExecutionHost } from "./vox-telemetry.js";
import { getEvaluationModel } from "../utils/models/evaluation.js";
import { coerceEvaluationInput } from "../utils/models/evaluation-questions.js";
import { formatModelReference } from "../utils/models/model-reference.js";

/**
 * Options for one evaluation call: the question set asked of the model and the per-call token
 * sink the caller wants populated with this evaluation's counts.
 *
 * @template TQuestions - The question map (id to question), which fixes the answer types
 */
export interface EvaluateOptions<TQuestions extends Record<string, EvaluationQuestion>> {
  /** Questions to ask the evaluating model about the state. */
  questions: TQuestions;
  /** Why this evaluation is running. Calls outside triage are execution evaluations. */
  purpose?: 'triage' | 'execution';
  /** Optional mutable object populated with this evaluation's token counts. */
  tokenOutput?: ExecuteTokenOutput;
}

/**
 * Run one evaluation call against a model: score the state against the question set under the
 * host's telemetry, sharing the run's abort signal and token sinks with the agent loop. Requires
 * an active root run. Evaluations report no reasoning tokens, so accrual records reasoning as 0.
 *
 * @param host - The execution host (the calling VoxContext) the evaluation runs under
 * @param model - The model configuration to evaluate with (native or chat-model evaluator)
 * @param state - The state under evaluation (coerced to JSON for the provider contract)
 * @param options - Evaluation options (question set and optional per-call token output)
 * @returns The provider's full evaluation result (typed answers, usage, and metadata)
 * @throws Error if called outside a run, or if the evaluation call fails (recorded on the span)
 */
export async function evaluateOn<TParameters extends AgentParameters, TQuestions extends Record<string, EvaluationQuestion>>(
  host: ExecutionHost<TParameters>,
  model: Model,
  state: unknown,
  options: EvaluateOptions<TQuestions>
): Promise<EvaluationResult<TQuestions>> {
  const root = host.activeRoot;
  if (!root) {
    throw new Error('VoxContext.evaluate requires an active run; call withRun() or forkRun().');
  }

  const input = coerceEvaluationInput(state);
  const span = host.tracer.startSpan('evaluate', {
    attributes: {
      'vox.context.id': host.id,
      'game.turn': String(root.parameters.turn),
      'model': formatModelReference(model),
      ...(host.currentAgentName ? { 'agent.name': host.currentAgentName } : {}),
      'evaluate.purpose': options.purpose ?? 'execution',
      'evaluate.state': JSON.stringify(input),
      'evaluate.questions': JSON.stringify(options.questions),
    }
  });

  // Mirror vox-execute: the evaluation's work runs under the span so nested model spans
  // (the chat-model adapter's step) parent to it in the active context.
  return await context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await experimental_evaluate({
        model: getEvaluationModel(model, host),
        state: input,
        questions: options.questions,
        // Cancellation: the active root's signal, so aborting the run stops the evaluation.
        abortSignal: host.currentSignal(),
      });

      const inputTokens = result.usage.inputTokens ?? 0;
      const outputTokens = result.usage.outputTokens ?? 0;
      const confidence = result.providerMetadata?.typesafe?.confidence;
      span.setAttributes({
        'evaluate.answers': JSON.stringify(result.answers),
        ...(confidence === undefined ? {} : { 'evaluate.confidence': JSON.stringify(confidence) }),
        'tokens.input': inputTokens,
        // Evaluations answer in one structured call and report no reasoning tokens.
        'tokens.reasoning': 0,
        'tokens.output': outputTokens,
      });
      accrueTokens(host, root, { inputTokens, reasoningTokens: 0, outputTokens }, options.tokenOutput);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      recordSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}
