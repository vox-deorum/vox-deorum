/** Tests for provider-agnostic model usage telemetry helpers. */

import { describe, expect, it } from 'vitest';
import type { LanguageModelUsage } from 'ai';
import { cachedInputTokensFromUsage } from '../../../src/utils/telemetry/model-usage.js';

/** Build the usage fields needed by cached-token telemetry tests. */
function usageWithCache(cacheReadTokens: number | undefined, cachedInputTokens?: number): LanguageModelUsage {
  return {
    inputTokens: 100,
    inputTokenDetails: { noCacheTokens: 20, cacheReadTokens, cacheWriteTokens: undefined },
    outputTokens: 10,
    outputTokenDetails: { textTokens: 10, reasoningTokens: 0 },
    totalTokens: 110,
    cachedInputTokens,
  };
}

describe('cachedInputTokensFromUsage', () => {
  it('reads the AI SDK provider-agnostic cache detail', () => {
    expect(cachedInputTokensFromUsage(usageWithCache(80))).toBe(80);
  });

  it('falls back to the deprecated AI SDK cache field', () => {
    expect(cachedInputTokensFromUsage(usageWithCache(undefined, 40))).toBe(40);
  });

  it.each([undefined, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'ignores an unavailable or invalid cache count: %s',
    (cachedInputTokens) => {
      expect(cachedInputTokensFromUsage(usageWithCache(cachedInputTokens))).toBeUndefined();
    },
  );
});
