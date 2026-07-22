/**
 * Converts raw Claude Code usage-limit notices into reset-aware retryable errors.
 */

import type { LanguageModelMiddleware } from 'ai';
import type { Query } from 'ai-sdk-provider-claude-code';
import { AsyncLocalStorage } from 'node:async_hooks';
import { preserveModelError } from '../preserved-model-error.js';

const noticeIntroductions = ["You've hit your ", 'You’ve hit your '];
const fallbackDelay = 5 * 60 * 1000;
const maximumResetDelay = 8 * 24 * 60 * 60 * 1000;
const resetGracePeriod = 15 * 1000;
const rawUsageLimitErrorStorage = new AsyncLocalStorage<PreserveClaudeCodeUsageLimitError>();

/** A retryable Claude Code subscription-limit failure. */
export interface ClaudeCodeUsageLimitError extends Error {
  isRetryable: true;
  retryAt: number;
}

/** Receive the raw usage-limit error before the provider replaces it. */
export type PreserveClaudeCodeUsageLimitError = (error: ClaudeCodeUsageLimitError) => void;

/** Return whether text begins with a Claude Code usage-limit introduction. */
export function isClaudeCodeUsageLimitNotice(text: string): boolean {
  return noticeIntroductions.some((introduction) => text.startsWith(introduction));
}

/** Return whether initial text can still begin with a usage-limit introduction. */
function canStartClaudeCodeUsageLimitNotice(text: string): boolean {
  return noticeIntroductions.some((introduction) =>
    introduction.startsWith(text) || text.startsWith(introduction));
}

/** Normalize a Claude reset timestamp to epoch milliseconds with a short grace period. */
function normalizeResetAt(resetAt: unknown, now: number): number | undefined {
  if (typeof resetAt !== 'number' || !Number.isFinite(resetAt)) return undefined;
  const milliseconds = resetAt < 1_000_000_000_000 ? resetAt * 1000 : resetAt;
  if (milliseconds <= now || milliseconds > now + maximumResetDelay) return undefined;
  return milliseconds + resetGracePeriod;
}

/** Return a validated absolute retry timestamp or the slow fallback. */
function resolveRetryAt(resetAt: unknown, now: number = Date.now()): number {
  return normalizeResetAt(resetAt, now) ?? now + fallbackDelay;
}

/** Build a retryable usage-limit error. */
function createUsageLimitError(
  notice: string,
  retryAt: number = Date.now() + fallbackDelay,
  cause?: unknown
): ClaudeCodeUsageLimitError {
  const error = new Error(notice, cause === undefined ? undefined : { cause }) as ClaudeCodeUsageLimitError;
  error.name = 'ClaudeCodeUsageLimitError';
  error.isRetryable = true;
  error.retryAt = retryAt;
  return error;
}

/** Return a usage-limit notice carried by an error-like value. */
function getUsageLimitNotice(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('message' in error)) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && isClaudeCodeUsageLimitNotice(message) ? message : undefined;
}

/** Return whether an error can be reused without losing retry metadata. */
function isReusableUsageLimitError(error: unknown): error is ClaudeCodeUsageLimitError {
  const now = Date.now();
  return error instanceof Error
    && error.name === 'ClaudeCodeUsageLimitError'
    && (error as Partial<ClaudeCodeUsageLimitError>).isRetryable === true
    && typeof (error as Partial<ClaudeCodeUsageLimitError>).retryAt === 'number'
    && Number.isFinite((error as Partial<ClaudeCodeUsageLimitError>).retryAt)
    && (error as Partial<ClaudeCodeUsageLimitError>).retryAt! > now
    && (error as Partial<ClaudeCodeUsageLimitError>).retryAt! <= now + maximumResetDelay + resetGracePeriod;
}

/** Reuse an original Claude error or rebuild it while retaining its cause and retry hint. */
function toUsageLimitError(notice: string, original?: unknown): ClaudeCodeUsageLimitError {
  if (isReusableUsageLimitError(original)) return original;
  const retryAt = original && typeof original === 'object' && 'retryAt' in original
    ? resolveRetryAt(original.retryAt)
    : resolveRetryAt(undefined);
  return createUsageLimitError(notice, retryAt, original);
}

/** Return text only when an SDK message is a text-only assistant response. */
function getAssistantText(message: any): string | undefined {
  const content = message?.type === 'assistant' ? message.message?.content : undefined;
  if (!Array.isArray(content) || content.length === 0
    || content.some((part: any) => part?.type !== 'text' || typeof part.text !== 'string')) {
    return undefined;
  }
  return content.map((part: any) => part.text).join('');
}

/** Reject a raw notice before provider structured-output validation can replace it. */
export function guardClaudeCodeQueryUsageLimits(
  query: Query,
  preserveError?: PreserveClaudeCodeUsageLimitError
): void {
  const originalIterator = query[Symbol.asyncIterator].bind(query);
  const source = { [Symbol.asyncIterator]: originalIterator };

  (query as any)[Symbol.asyncIterator] = async function* () {
    let rejectedResetAt: unknown;
    for await (const message of source) {
      if (message?.type === 'rate_limit_event'
        && message.rate_limit_info?.status === 'rejected') {
        rejectedResetAt = message.rate_limit_info.resetsAt;
      }
      const text = getAssistantText(message);
      if (text !== undefined && isClaudeCodeUsageLimitNotice(text)) {
        const error = createUsageLimitError(text, resolveRetryAt(rejectedResetAt));
        (preserveError ?? rawUsageLimitErrorStorage.getStore())?.(error);
        throw error;
      }
      yield message;
    }
  };
}

/** Reject text notices and preserve usage-limit error chunks for the retry layer. */
export function claudeCodeResponseMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    wrapStream: async ({ doStream, params }) => {
      let rawUsageLimitError: ClaudeCodeUsageLimitError | undefined;
      const { stream, ...rest } = await rawUsageLimitErrorStorage.run(
        (error) => { rawUsageLimitError = error; },
        doStream,
      );
      const heldParts: any[] = [];
      let initialText = '';
      let checkingText = true;

      return {
        ...rest,
        stream: stream.pipeThrough(new TransformStream({
          transform(part, controller) {
            /** Reject the current response as a reset-aware usage-limit error. */
            const rejectNotice = (notice: string, original?: unknown): void => {
              const error = toUsageLimitError(notice, original);
              preserveModelError(params, error);
              controller.error(error);
            };

            /** Publish the initial parts once they cannot be a notice. */
            const flushHeldParts = (): void => {
              for (const heldPart of heldParts) controller.enqueue(heldPart);
              heldParts.length = 0;
            };

            if (part.type === 'error') {
              const notice = getUsageLimitNotice(part.error)
                ?? (isClaudeCodeUsageLimitNotice(initialText) ? initialText : undefined);
              if (notice !== undefined) {
                const original = rawUsageLimitError ?? part.error;
                rawUsageLimitError = undefined;
                rejectNotice(notice, original);
                return;
              }
            }

            if (!checkingText) {
              controller.enqueue(part);
              return;
            }

            if (part.type === 'text-start') {
              heldParts.push(part);
              return;
            }

            if (part.type === 'text-delta') {
              heldParts.push(part);
              initialText += part.delta;
              if (!canStartClaudeCodeUsageLimitNotice(initialText)) {
                flushHeldParts();
                checkingText = false;
              }
              return;
            }

            if (part.type === 'text-end') {
              heldParts.push(part);
              if (isClaudeCodeUsageLimitNotice(initialText)) {
                rejectNotice(initialText);
                return;
              }
              flushHeldParts();
              checkingText = false;
              return;
            }

            if (part.type === 'stream-start' || part.type === 'response-metadata' || part.type === 'raw') {
              controller.enqueue(part);
              return;
            }

            flushHeldParts();
            checkingText = false;
            controller.enqueue(part);
          },
          flush(controller) {
            if (checkingText && isClaudeCodeUsageLimitNotice(initialText)) {
              const error = toUsageLimitError(initialText);
              preserveModelError(params, error);
              controller.error(error);
              return;
            }
            for (const heldPart of heldParts) controller.enqueue(heldPart);
          },
        })),
      };
    },
  };
}
