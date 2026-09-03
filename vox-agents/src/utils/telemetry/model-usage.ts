/** Provider-agnostic model usage helpers for telemetry. */

import type { LanguageModelUsage } from 'ai';

/** Return the provider-reported cache-read count when the AI SDK exposes one. */
export function cachedInputTokensFromUsage(usage: LanguageModelUsage): number | undefined {
  const cachedInputTokens = usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens;
  return typeof cachedInputTokens === 'number'
    && Number.isFinite(cachedInputTokens)
    && cachedInputTokens >= 0
    ? cachedInputTokens
    : undefined;
}
