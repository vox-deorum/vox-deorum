/** Provider-agnostic model usage helpers for telemetry. */

import type { LanguageModelUsage, ModelMessage } from 'ai';
import { countMessagesTokens } from '../models/token-counter.js';

/** One model step's token counts, as recorded on the step span and accrued to the run. */
export interface StepTokenUsage {
  /** Prompt tokens for the step. */
  inputTokens: number;
  /** Provider-reported cache-read tokens, when the provider reports any. */
  cachedInputTokens?: number;
  /** Reasoning tokens, provider-reported or locally estimated. */
  reasoningTokens: number;
  /** Visible response tokens. */
  outputTokens: number;
}

/** Return the provider-reported cache-read count when the AI SDK exposes one. */
export function cachedInputTokensFromUsage(usage: LanguageModelUsage): number | undefined {
  const cachedInputTokens = usage.inputTokenDetails?.cacheReadTokens;
  return typeof cachedInputTokens === 'number'
    && Number.isFinite(cachedInputTokens)
    && cachedInputTokens >= 0
    ? cachedInputTokens
    : undefined;
}

/**
 * Resolve one model step's token counts from the prompt it was given and the response it produced.
 *
 * Input takes the larger of the locally counted prompt and the provider's own figure, because some
 * providers under-report it. Reasoning prefers the provider's detail field and falls back to a
 * local count of the response's reasoning parts, raised to the provider's output total minus the
 * visible output whenever that is larger, so hidden reasoning still lands somewhere.
 *
 * @param promptMessages - The messages sent to the model for this step
 * @param usage - The provider's reported usage for the step
 * @param responseMessages - The messages the model produced
 * @returns The step's input, cached input, reasoning, and output token counts
 */
export function stepTokenUsage(
  promptMessages: ModelMessage[],
  usage: LanguageModelUsage,
  responseMessages: ModelMessage[]
): StepTokenUsage {
  const inputTokens = Math.max(countMessagesTokens(promptMessages, false), usage.inputTokens ?? 0);
  const outputTokens = countMessagesTokens(responseMessages, false);

  let reasoningTokens = usage.outputTokenDetails?.reasoningTokens ?? 0;
  if (reasoningTokens === 0) {
    reasoningTokens = countMessagesTokens(responseMessages, true);
    if (reasoningTokens > 0) {
      reasoningTokens = Math.max(reasoningTokens, (usage.outputTokens ?? 0) - outputTokens);
    }
  }

  return {
    inputTokens,
    cachedInputTokens: cachedInputTokensFromUsage(usage),
    reasoningTokens,
    outputTokens,
  };
}
