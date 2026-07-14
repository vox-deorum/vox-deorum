/**
 * Converts raw Claude Code usage-limit notices into non-retryable model errors.
 */

import type { LanguageModelMiddleware } from 'ai';
import type { Query } from 'ai-sdk-provider-claude-code';
import { preserveModelError } from './preserved-model-error.js';

const noticeIntroductions = ["You've hit your ", 'You’ve hit your '];

/** Return whether text begins with a Claude Code usage-limit introduction. */
export function isClaudeCodeUsageLimitNotice(text: string): boolean {
  return noticeIntroductions.some((introduction) => text.startsWith(introduction));
}

/** Return whether initial text can still begin with a usage-limit introduction. */
function canStartClaudeCodeUsageLimitNotice(text: string): boolean {
  return noticeIntroductions.some((introduction) =>
    introduction.startsWith(text) || text.startsWith(introduction));
}

/** Build an error that stops the retry loop. */
function createUsageLimitError(notice: string): Error & { isRetryable: false } {
  const error = new Error(notice) as Error & { isRetryable: false };
  error.name = 'ClaudeCodeUsageLimitError';
  error.isRetryable = false;
  return error;
}

/** Return a usage-limit notice carried by an error-like value. */
function getUsageLimitNotice(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('message' in error)) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && isClaudeCodeUsageLimitNotice(message) ? message : undefined;
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
export function guardClaudeCodeQueryUsageLimits(query: Query): void {
  const originalIterator = query[Symbol.asyncIterator].bind(query);
  const source = { [Symbol.asyncIterator]: originalIterator };

  (query as any)[Symbol.asyncIterator] = async function* () {
    for await (const message of source) {
      const text = getAssistantText(message);
      if (text !== undefined && isClaudeCodeUsageLimitNotice(text)) {
        throw createUsageLimitError(text);
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
      const { stream, ...rest } = await doStream();
      const heldParts: any[] = [];
      let initialText = '';
      let checkingText = true;

      return {
        ...rest,
        stream: stream.pipeThrough(new TransformStream({
          transform(part, controller) {
            /** Reject the current response as a non-retryable usage-limit error. */
            const rejectNotice = (notice: string): void => {
              const error = createUsageLimitError(notice);
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
                rejectNotice(notice);
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
              const error = createUsageLimitError(initialText);
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
