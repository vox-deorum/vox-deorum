/**
 * @module utils/models/evaluation
 *
 * Evaluation-model factory mirroring getEmbeddingModel. The provider is the
 * discriminator: `typesafe` builds the native Jev model from
 * `@ai-sdk/typesafe-ai`, and any chat provider is wrapped in a structured-output
 * adapter that implements the AI SDK evaluation contract over `getModel(config)`,
 * so evaluation-based features work without a TypeSafe key.
 */

import { Output } from 'ai';
import { createTypeSafeAi } from '@ai-sdk/typesafe-ai';
import type {
  Experimental_EvaluationModelV4 as EvaluationModelV4,
  Experimental_EvaluationModelV4CallOptions as EvaluationModelV4CallOptions,
  Experimental_EvaluationModelV4Result as EvaluationModelV4Result,
} from '@ai-sdk/provider';
// @ts-expect-error - jaison doesn't have type definitions
import jaison from 'jaison';
import { createLogger } from '../logger.js';
import type { Model } from '../../types/index.js';
import { buildProviderOptions, getModel, getModelConfig } from './models.js';
import { selectEvaluatorReference } from './resolution.js';
import { streamTextWithConcurrency, withModelConfig } from './concurrency.js';
import type { ConcurrencyContext } from './concurrency.js';
import { formatModelReference } from './model-reference.js';
import { buildEvaluatorPrompt, normalizeAnswers, questionsToSchema } from './evaluation-questions.js';

/** Stand-in execution context for evaluator calls made outside a run. */
const detachedContext: ConcurrencyContext = { logger: createLogger('evaluation'), timeoutRefresh: undefined };

/**
 * Resolve the evaluation model configuration for one agent: the reference from
 * `selectEvaluatorReference` (`<name>.evaluator`, then `evaluator`), loaded
 * through `getModelConfig`. Returns undefined when the agent (and the global
 * scope) registers no evaluator, so triage callers can skip cleanly rather than
 * fall back to a chat default.
 *
 * @param name - The agent whose evaluator reference to resolve
 * @param overrides - Seat-level model configuration overrides
 * @returns The evaluator's model configuration, or undefined when none is registered
 */
export function getEvaluatorConfig(name: string, overrides?: Record<string, Model | string>): Model | undefined {
  const reference = selectEvaluatorReference(name, overrides);
  if (reference === undefined) return undefined;
  return getModelConfig(reference, undefined, overrides);
}

/**
 * Get an evaluation model instance from a model configuration. The `typesafe`
 * provider returns the native evaluation model; every other (chat) provider is
 * adapted through `createLanguageModelEvaluator`.
 *
 * @param config - Model configuration object (typically resolved from the `evaluator` alias)
 * @param context - Execution context for retry logging and timeout refresh; defaults to a detached one
 * @returns An AI SDK evaluation model ready for `experimental_evaluate`
 */
export function getEvaluationModel(config: Model, context?: ConcurrencyContext): EvaluationModelV4 {
  switch (config.provider) {
    case 'typesafe':
      return createTypeSafeAi().evaluationModel(config.name);
    default:
      return createLanguageModelEvaluator(config, context ?? detachedContext);
  }
}

/**
 * Wrap a chat-model configuration in the AI SDK evaluation contract. One
 * `doEvaluate` call is exactly one chat step: the questions become a zod schema
 * plus a single user prompt, run through `streamTextWithConcurrency` with
 * structured output so per-model concurrency, retry logging, and token
 * accounting stay uniform with the agent loop. The reply text is leniently
 * parsed with the VoxAgent.getOutput idiom (strip code fences, jaison, then
 * schema) and normalized into answers that pass the SDK's strict validation.
 * Chat models from `getModel()` carry tool-rescue middleware; that is harmless
 * for a no-tools structured-output step, so nothing wraps this model further.
 *
 * @param config - Chat model configuration serving as the evaluator
 * @param context - Execution context (logger plus timeout-refresh slot)
 * @returns An evaluation model over the chat stack
 */
export function createLanguageModelEvaluator(config: Model, context: ConcurrencyContext): EvaluationModelV4 {
  return {
    specificationVersion: 'v4',
    provider: config.provider,
    modelId: config.name,
    supportedQuestionTypes: ['choice', 'score', 'boolean'],
    doEvaluate: async (options: EvaluationModelV4CallOptions): Promise<EvaluationModelV4Result> => {
      const schema = questionsToSchema(options.questions);
      const prompt = buildEvaluatorPrompt(options.state, options.questions);
      const result = await streamTextWithConcurrency(
        withModelConfig({
          model: getModel(config),
          providerOptions: buildProviderOptions(config),
          // Disable the AI SDK's internal retry to let the concurrency wrapper handle it
          maxRetries: 0,
          abortSignal: options.abortSignal,
          messages: [{ role: 'user' as const, content: prompt }],
          output: Output.object({ schema }),
          // One chat step answers every question.
          stopWhen: () => true,
        }, config),
        context,
      );

      const steps = result.steps;
      const lastStep = steps[steps.length - 1];
      // Leniently parse the step's text the way VoxAgent.getOutput does:
      // strip code fences, jaison, then schema.
      let parsed: unknown = null;
      const text = typeof lastStep?.text === 'string'
        ? lastStep.text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
        : '';
      if (text) {
        try {
          parsed = schema.parse(jaison(text));
        } catch {
          parsed = null;
        }
      }
      if (parsed === null || parsed === undefined) {
        throw new Error(`Evaluation model '${formatModelReference(config)}' returned no parsable answer set.`);
      }

      return {
        answers: normalizeAnswers(options.questions, parsed),
        usage: {
          inputTokens: lastStep?.usage?.inputTokens,
          outputTokens: lastStep?.usage?.outputTokens,
        },
        warnings: [],
        response: { modelId: config.name, timestamp: new Date() },
        // No rounding: the adapter normalizes at full precision.
      };
    },
  };
}
