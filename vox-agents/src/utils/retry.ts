/**
 * @module utils/retry
 *
 * Utility function for exponential retry logic with jitter.
 * Implements retry strategies to handle transient failures in async operations.
 */

import { Logger } from "winston";
import { setTimeout } from 'node:timers/promises';

/** Pattern matching context-length-exceeded errors from LLM providers. */
const contextLengthPattern = /input.*tokens.*is longer than.*context.length|token limit|context length|maximum input|maximum context|ContextWindowExceeded|max_tokens/i;

/** Check whether an error indicates the input exceeded the model's context window. */
export function isContextLengthError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && '__contextLengthError' in error) return true;
  const message = error instanceof Error ? error.message : String(error);
  return contextLengthPattern.test(message);
}

/**
 * Executes an async function with exponential backoff retry logic
 * @param fn - The async function to execute, receives a progress callback to prevent timeout
 * @param logger - Winston logger instance for logging retry attempts
 * @param handleReject - A custom handler for timeout reject. True = log as a warning only.
 * @param source - Source identifier for logging (e.g., model name)
 * @param maxRetries - Maximum number of retry attempts (default: 100)
 * @param initialDelay - Initial delay in milliseconds (default: 5000)
 * @param maxDelay - Maximum delay in milliseconds (default: 120000)
 * @param backoffFactor - Exponential backoff multiplier (default: 1.5)
 * @param executionTimeout - Maximum time to wait after each progress update (default: 5 minutes)
 * @returns The result of the successful function execution
 * @throws The last error if all retries are exhausted
 */
export async function exponentialRetry<T>(
  fn: (updateProgress: (completed?: boolean) => void, iteration: number) => Promise<T>,
  logger: Logger,
  handleReject?: () => boolean,
  source: string = 'unknown',
  maxRetries: number = 100,
  initialDelay: number = 5000,
  maxDelay: number = 180000,
  backoffFactor: number = 1.2,
  executionTimeout: number = 300000 // 5 minutes
): Promise<T> {
  let lastError: Error;
  let delay = initialDelay;
  let hasCompleted = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Timeout support
      let timeoutHandle: NodeJS.Timeout | null = null;
      let isTimedOut = false;
      let lastKnown = new Date();
      let timeoutReject: (reason: Error) => void;
      let request: Promise<T> | undefined;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutReject = reject;
      });

      const resetTimeout = (completed?: boolean) => {
        lastKnown = new Date();
        hasCompleted  = hasCompleted ?? completed;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (completed) isTimedOut = true;
        if (!isTimedOut && !hasCompleted) {
          timeoutHandle = globalThis.setTimeout(() => {
            if (isTimedOut || hasCompleted) return;
            isTimedOut = true;
            // Build the message
            let message = `[${source}] Function execution timed out after ${executionTimeout}ms (${executionTimeout / 60000} minutes). Last known activity: ${lastKnown.toLocaleTimeString('en-US', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })}`;
            // If a custom reject handler doesn't want to throw, log as a warning
            if (handleReject && handleReject()) {
              logger.warn(message + ", rescued");
            } else {
              timeoutReject(new Error(message));
            }
          }, executionTimeout);
        }
      };
      
      // Start initial timeout
      resetTimeout(false);
      request = fn(resetTimeout, attempt).then((value) => { hasCompleted = true; return value; });

      // Race between the function execution and timeout
      const result = await Promise.race([
        request,
        timeoutPromise
      ]);

      // Clear the timeout if execution completed successfully
      if (timeoutHandle) clearTimeout(timeoutHandle);
      return result;
    } catch (error) {
      lastError = error as Error;

      // Check if error is explicitly marked as non-retryable
      const isNonRetryable = error && typeof error === 'object' && 'isRetryable' in error && error.isRetryable === false;

      // Context length exceeded — retrying won't help, fail immediately
      if (isContextLengthError(error)) {
        logger.warn(`[${source}] Context length exceeded, terminating retry`, lastError);
        throw lastError;
      }

      if (attempt === maxRetries) {
        logger.warn(`[${source}] Non-retryable error`, lastError);
        throw lastError;
      }

      if (attempt === maxRetries || isNonRetryable) {
        throw lastError;
      }

      // Calculate next delay with exponential backoff
      const currentDelay = Math.min(delay, maxDelay);

      // Add jitter to prevent thundering herd
      const jitter = Math.random() * 0.1 * currentDelay;
      const totalDelay = currentDelay + jitter;

      // Log retry attempt
      logger.warn(`[${source}] Retry attempt ${attempt + 1}/${maxRetries} after error, delaying ${Math.round(totalDelay)}ms`, lastError);
      await setTimeout(totalDelay);

      // Increase delay for next attempt
      delay *= backoffFactor;
    }
  }

  throw lastError!;
}
