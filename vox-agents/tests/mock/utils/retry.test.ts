/**
 * Tests for shared exponential retry classification, delay hints, and cancellation.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const timerMocks = vi.hoisted(() => ({
  setTimeout: vi.fn(),
}));

vi.mock('node:timers/promises', () => ({
  setTimeout: timerMocks.setTimeout,
}));

import { exponentialRetry } from '../../../src/utils/retry.js';

/** Build the Winston subset used by exponentialRetry. */
function logger() {
  return { warn: vi.fn() } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
  timerMocks.setTimeout.mockReset();
});

describe('exponentialRetry', () => {
  it('should honor an absolute retry timestamp beyond the ordinary delay cap', async () => {
    const now = Date.UTC(2026, 6, 15, 15, 45);
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    timerMocks.setTimeout.mockResolvedValue(undefined);
    const error = Object.assign(new Error('limited'), {
      isRetryable: true,
      retryAt: now + 10 * 60 * 1000,
    });
    const operation = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('ok');

    await expect(exponentialRetry(
      operation,
      logger(),
      {
        source: 'hinted',
        maxRetries: 2,
        initialDelay: 1000,
        maxDelay: 2000,
        backoffFactor: 2,
      },
    )).resolves.toBe('ok');

    expect(timerMocks.setTimeout).toHaveBeenCalledWith(
      10 * 60 * 1000 + 2500,
      undefined,
      { signal: undefined },
    );
  });

  it('should retain proportional jitter for ordinary exponential retries', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    timerMocks.setTimeout.mockResolvedValue(undefined);
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('ok');

    await expect(exponentialRetry(
      operation,
      logger(),
      {
        source: 'ordinary',
        maxRetries: 2,
        initialDelay: 1000,
        maxDelay: 2000,
        backoffFactor: 2,
      },
    )).resolves.toBe('ok');

    expect(timerMocks.setTimeout).toHaveBeenCalledWith(1050, undefined, { signal: undefined });
  });

  it.each([
    ['explicitly non-retryable', Object.assign(new Error('stop'), { isRetryable: false })],
    ['context length', new Error('maximum context length exceeded')],
  ])('should fail immediately for %s errors', async (_label, error) => {
    const operation = vi.fn().mockRejectedValue(error);

    await expect(exponentialRetry(operation, logger())).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(timerMocks.setTimeout).not.toHaveBeenCalled();
  });

  it('should stop after the configured retry budget is exhausted', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    timerMocks.setTimeout.mockResolvedValue(undefined);
    const error = new Error('still failing');
    const operation = vi.fn().mockRejectedValue(error);

    await expect(exponentialRetry(
      operation,
      logger(),
      { source: 'budget', maxRetries: 1, initialDelay: 1000 },
    )).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(timerMocks.setTimeout).toHaveBeenCalledTimes(1);
  });

  it('should cancel a provider-directed wait through the active signal', async () => {
    const controller = new AbortController();
    const stopped = new Error('stopped');
    const now = Date.UTC(2026, 6, 15, 15, 45);
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    timerMocks.setTimeout.mockImplementation((_delay, _value, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }));
    const error = Object.assign(new Error('limited'), { retryAt: now + 60_000 });
    const pending = exponentialRetry(
      vi.fn().mockRejectedValue(error),
      logger(),
      {
        source: 'abort',
        maxRetries: 2,
        initialDelay: 1000,
        maxDelay: 2000,
        backoffFactor: 2,
        executionTimeout: 300_000,
        abortSignal: controller.signal,
      },
    );
    await vi.waitFor(() => expect(timerMocks.setTimeout).toHaveBeenCalledOnce());

    controller.abort(stopped);

    await expect(pending).rejects.toBe(stopped);
  });
});
