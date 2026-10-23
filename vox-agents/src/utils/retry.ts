/**
 * @module utils/retry
 *
 * Utility function for exponential retry logic with jitter.
 * Implements retry strategies to handle transient failures in async operations.
 */

import { Logger } from "winston";
import { setTimeout } from 'node:timers/promises';
import { errorMessage } from './errors.js';

/** Shared inactivity budget for one model execution attempt. */
export const executionTimeoutDefault = 300_000;

/** Pattern matching context-length-exceeded errors from LLM providers. */
const contextLengthPattern = /input.*tokens.*is longer than.*context.length|token limit|context length|maximum input|maximum context|ContextWindowExceeded|max_tokens/i;

/** Named retry policy and cancellation settings. */
export interface ExponentialRetryOptions {
  source?: string;
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  executionTimeout?: number;
  /** Initial deadline before the first progress update. Defaults to executionTimeout. */
  initialExecutionTimeout?: number;
  abortSignal?: AbortSignal;
}

/** Check whether an error indicates the input exceeded the model's context window. */
export function isContextLengthError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && '__contextLengthError' in error) return true;
  const message = errorMessage(error);
  return contextLengthPattern.test(message);
}

/**
 * Executes an async function with exponential backoff retry logic
 * @param fn - The async function to execute. It receives a progress callback to prevent timeout,
 *   the attempt number, and an attempt signal that aborts with `abortSignal` or when the attempt times out
 * @param logger - Winston logger instance for logging retry attempts
 * @param options - Named retry policy and cancellation settings
 * @returns The result of the successful function execution
 * @throws The last error if all retries are exhausted
 */
export async function exponentialRetry<T>(
  fn: (updateProgress: (completed?: boolean) => void, iteration: number, signal: AbortSignal) => Promise<T>,
  logger: Logger,
  options: ExponentialRetryOptions = {},
): Promise<T> {
  const {
    source = 'unknown',
    maxRetries = 100,
    initialDelay = 5000,
    maxDelay = 180000,
    backoffFactor = 1.2,
    executionTimeout = executionTimeoutDefault,
    initialExecutionTimeout = executionTimeout,
    abortSignal,
  } = options;
  let lastError: Error;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    abortSignal?.throwIfAborted();
    let timeoutHandle: NodeJS.Timeout | null = null;
    let hasCompleted = false;
    // Cancels this attempt's work when it times out, so it cannot keep running beside the retry.
    const attemptController = new AbortController();
    const attemptSignal = abortSignal
      ? AbortSignal.any([abortSignal, attemptController.signal])
      : attemptController.signal;
    try {
      // Timeout support
      let isTimedOut = false;
      let lastKnown = new Date();
      let timeoutReject: (reason: Error) => void;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutReject = reject;
      });

      const resetTimeout = (completed?: boolean, timeout = executionTimeout) => {
        lastKnown = new Date();
        // Late progress cannot restart a completed attempt's timer.
        hasCompleted = hasCompleted || completed === true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (completed) isTimedOut = true;
        if (!isTimedOut && !hasCompleted) {
          timeoutHandle = globalThis.setTimeout(() => {
            if (isTimedOut || hasCompleted) return;
            isTimedOut = true;
            const message = `[${source}] Function execution timed out after ${timeout}ms (${timeout / 60000} minutes). Last known activity: ${lastKnown.toLocaleTimeString('en-US', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })}`;
            const timeoutError = new Error(message);
            timeoutReject(timeoutError);
            attemptController.abort(timeoutError);
          }, timeout);
        }
      };
      
      // Start initial timeout
      resetTimeout(false, initialExecutionTimeout);
      const request = fn(resetTimeout, attempt, attemptSignal).then((value) => { hasCompleted = true; return value; });

      // Race between the function execution and timeout; finally clears the timer on success
      return await Promise.race([
        request,
        timeoutPromise
      ]);
    } catch (error) {
      // Settle the attempt now, because finally runs only after the retry delay.
      hasCompleted = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      abortSignal?.throwIfAborted();
      lastError = error as Error;

      // Compatible proxies can use 403 for temporary model access or routing failures, so let the
      // shared retry policy try those again even though the AI SDK marks every 403 as terminal.
      const isRetryableForbidden = error !== null
        && typeof error === 'object'
        && 'statusCode' in error
        && error.statusCode === 403;

      // Check if error is explicitly marked as non-retryable.
      const isNonRetryable = !isRetryableForbidden
        && error
        && typeof error === 'object'
        && 'isRetryable' in error
        && error.isRetryable === false;

      // Context length exceeded — retrying won't help, fail immediately
      if (isContextLengthError(error)) {
        logger.warn(`[${source}] Context length exceeded, terminating retry`, lastError);
        throw lastError;
      }

      // Explicitly non-retryable — don't burn attempts on it
      if (isNonRetryable) {
        logger.warn(`[${source}] Non-retryable error, terminating retry`, lastError);
        throw lastError;
      }

      // Retries exhausted
      if (attempt === maxRetries) {
        logger.warn(`[${source}] Retries exhausted after ${maxRetries} attempts`, lastError);
        throw lastError;
      }

      // Calculate the ordinary exponential delay, then honor any provider-directed minimum.
      const currentDelay = Math.min(delay, maxDelay);
      const now = Date.now();
      const retryAt = error && typeof error === 'object' && 'retryAt' in error
        && typeof error.retryAt === 'number' && Number.isFinite(error.retryAt)
        && error.retryAt > now
        ? error.retryAt
        : undefined;
      const hintedDelay = retryAt === undefined ? undefined : retryAt - now;
      const baseDelay = hintedDelay === undefined
        ? currentDelay
        : Math.max(currentDelay, hintedDelay);

      // Long provider-directed waits need only a small stagger, while ordinary retries keep
      // their proportional jitter.
      const jitter = hintedDelay === undefined
        ? Math.random() * 0.1 * currentDelay
        : Math.random() * 5000;
      const totalDelay = baseDelay + jitter;
      const scheduledRetryAt = now + totalDelay;

      // Log retry attempt
      logger.warn(
        `[${source}] Retry attempt ${attempt + 1}/${maxRetries} after error, delaying ${Math.round(totalDelay)}ms until ${new Date(scheduledRetryAt).toISOString()}`,
        lastError
      );
      abortSignal?.throwIfAborted();
      await setTimeout(totalDelay, undefined, { signal: abortSignal });

      // Increase delay for next attempt
      delay *= backoffFactor;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  throw lastError!;
}
