/**
 * Mock-tier tests for provider errors that arrive after a stream has opened.
 *
 * The AI SDK turns such an error into an `error` stream part and still resolves the step with
 * finishReason "error". streamTextWithConcurrency must rethrow it so the shared retry policy runs.
 */

import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';

// Skip the real backoff delay between attempts.
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }));

import { streamTextWithConcurrency } from '../../../src/utils/models/concurrency.js';
import { logger } from '../../../src/utils/logger.js';

/** Build stream chunks that start a text reply and then fail with the given provider error. */
function failingChunks(error: Record<string, unknown>) {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'partial' },
    { type: 'error', error },
  ];
}

/** Build stream chunks for a complete text reply. */
function successChunks(text: string) {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: text },
    { type: 'text-end', id: 't' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
    },
  ];
}

/** Build a mock model that answers each call with the next chunk list in order. */
function sequencedModel(responses: unknown[][]) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: responses[call++] as any }),
    }),
  });
}

/** Run one step through the concurrency wrapper. */
function runStep(model: MockLanguageModelV4) {
  return streamTextWithConcurrency({
    model,
    prompt: 'hi',
    maxRetries: 0,
    stopWhen: () => true,
  } as any, { logger, timeoutRefresh: undefined });
}

describe('streamTextWithConcurrency mid-stream errors', () => {
  it('should retry a retryable provider error and return the next attempt', async () => {
    const model = sequencedModel([
      failingChunks({ message: 'Response payload is not completed', code: '500', isRetryable: true }),
      successChunks('answer'),
    ]);

    const result: any = await runStep(model);

    expect(model.doStreamCalls).toHaveLength(2);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].text).toBe('answer');
  });

  it('should throw a non-retryable provider error without another attempt', async () => {
    const model = sequencedModel([
      failingChunks({ message: 'bad request', isRetryable: false }),
      successChunks('unused'),
    ]);

    await expect(runStep(model)).rejects.toMatchObject({ isRetryable: false });
    expect(model.doStreamCalls).toHaveLength(1);
  });
});
