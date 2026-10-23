/** Behavioral coverage for the initial response and streaming inactivity deadlines. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';

// Keep retries immediate so each test observes only the response deadlines.
vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }));

import { getExecutionTimeout, streamTextWithConcurrency } from '../../../src/utils/models/concurrency.js';
import { httpTimeouts, readModelTimeout, validateModelTimeouts } from '../../../src/utils/models/timeouts.js';
import { createFakeLogger } from '../../helpers/fake-logger.js';

/** Complete a provider stream with a successful answer. */
function finish(controller: ReadableStreamDefaultController<any>) {
  controller.enqueue({ type: 'text-start', id: 'reply' });
  controller.enqueue({ type: 'text-delta', id: 'reply', delta: 'answer' });
  controller.enqueue({ type: 'text-end', id: 'reply' });
  controller.enqueue({
    type: 'finish',
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
  });
  controller.close();
}

/** Run a single step with the real AI SDK and an injected mock provider. */
function runStep(model: MockLanguageModelV4) {
  return streamTextWithConcurrency({ model, prompt: 'hi', maxRetries: 0, stopWhen: () => true }, {
    logger: createFakeLogger() as any,
    timeoutRefresh: undefined,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('LLM_FIRST_TOKEN_TIMEOUT_MS', '100');
  vi.stubEnv('LLM_STREAM_TIMEOUT_MS', '20');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('model response deadlines', () => {
  it('should retain the first-token budget after stream metadata arrives', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            setTimeout(() => finish(controller), 80);
          },
        }),
      }),
    });

    const pending = runStep(model);
    await vi.advanceTimersByTimeAsync(80);
    const result: any = await pending;

    expect(model.doStreamCalls).toHaveLength(1);
    expect(result.steps[0].text).toBe('answer');
  });

  it('should cancel and retry an attempt that never opens a response stream', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        if (calls++ === 0) {
          return await new Promise((_resolve, reject) => {
            options.abortSignal!.addEventListener('abort', () => reject(options.abortSignal!.reason), { once: true });
          });
        }
        return { stream: new ReadableStream({ start: finish }) };
      },
    });

    const pending = runStep(model);
    await vi.advanceTimersByTimeAsync(99);
    expect(model.doStreamCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const result: any = await pending;

    expect(model.doStreamCalls).toHaveLength(2);
    expect(model.doStreamCalls[0].abortSignal!.aborted).toBe(true);
    expect(result.steps[0].text).toBe('answer');
  });

  it('should switch to the streaming budget after the first reasoning token', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            if (calls++ === 0) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              controller.enqueue({ type: 'reasoning-start', id: 'thought' });
              controller.enqueue({ type: 'reasoning-delta', id: 'thought', delta: 'thinking' });
            } else {
              finish(controller);
            }
          },
        }),
      }),
    });

    const pending = runStep(model);
    await vi.advanceTimersByTimeAsync(19);
    expect(model.doStreamCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const result: any = await pending;

    expect(model.doStreamCalls).toHaveLength(2);
    expect(model.doStreamCalls[0].abortSignal!.aborted).toBe(true);
    expect(result.steps[0].text).toBe('answer');
  });

  it('should refresh the streaming budget while output continues beyond the initial deadline', async () => {
    vi.stubEnv('LLM_FIRST_TOKEN_TIMEOUT_MS', '10');
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 'reply' });
            controller.enqueue({ type: 'text-delta', id: 'reply', delta: 'hello' });
            setTimeout(() => controller.enqueue({ type: 'text-delta', id: 'reply', delta: ' world' }), 15);
            setTimeout(() => finish(controller), 30);
          },
        }),
      }),
    });

    const pending = runStep(model);
    await vi.advanceTimersByTimeAsync(30);
    await pending;

    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doStreamCalls[0].abortSignal!.aborted).toBe(false);
  });
});

describe('timeout environment values', () => {
  it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '10s', '2147483648'])(
    'should reject invalid millisecond values: %s', (value) => {
      vi.stubEnv('LLM_FIRST_TOKEN_TIMEOUT_MS', value);
      expect(() => readModelTimeout('LLM_FIRST_TOKEN_TIMEOUT_MS')).toThrow(/LLM_FIRST_TOKEN_TIMEOUT_MS/);
    },
  );

  it('should retain provider defaults for blank overrides', () => {
    const local = { provider: 'openai-compatible', name: 'local' };
    vi.stubEnv('USE_FLEX', 'false');
    delete process.env.LLM_FIRST_TOKEN_TIMEOUT_MS;
    delete process.env.LLM_STREAM_TIMEOUT_MS;
    const unset = [getExecutionTimeout(undefined), getExecutionTimeout(local), httpTimeouts(180_000)];

    vi.stubEnv('LLM_FIRST_TOKEN_TIMEOUT_MS', ' ');
    vi.stubEnv('LLM_STREAM_TIMEOUT_MS', '');
    expect(readModelTimeout('LLM_FIRST_TOKEN_TIMEOUT_MS')).toBeUndefined();
    expect([getExecutionTimeout(undefined), getExecutionTimeout(local), httpTimeouts(180_000)]).toEqual(unset);
  });

  it('should validate an environment that is not yet loaded', () => {
    expect(() => validateModelTimeouts({ LLM_STREAM_TIMEOUT_MS: '2m' })).toThrow(/LLM_STREAM_TIMEOUT_MS/);
    expect(() => validateModelTimeouts({ LLM_FIRST_TOKEN_TIMEOUT_MS: '900000', OTHER: 'x' })).not.toThrow();
  });
});

describe('HTTP client deadlines', () => {
  it('should wait for headers as long as the streaming limit when no first-token limit is set', () => {
    vi.stubEnv('LLM_FIRST_TOKEN_TIMEOUT_MS', '');
    vi.stubEnv('LLM_STREAM_TIMEOUT_MS', '1200000');
    expect(httpTimeouts(180_000)).toEqual({ headersTimeout: 1_200_000, bodyTimeout: 1_200_000 });
  });

  it('should wait for headers as long as the first-token limit and keep the longer body limit', () => {
    vi.stubEnv('LLM_FIRST_TOKEN_TIMEOUT_MS', '900000');
    vi.stubEnv('LLM_STREAM_TIMEOUT_MS', '120000');
    expect(httpTimeouts(180_000)).toEqual({ headersTimeout: 900_000, bodyTimeout: 900_000 });
  });
});
