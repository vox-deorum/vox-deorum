/**
 * @module utils/models/tool-rescue/stream-parts
 *
 * The provider stream parts the rescue synthesizes on its way out. Rescued calls and recovered
 * prose never arrived as parts of their own — they were carved out of model text — so the stream
 * half has to mint parts the AI SDK will accept in their place.
 */

import type { LanguageModelV4StreamPart, LanguageModelV4ToolCall } from '@ai-sdk/provider';

/** Emit rescued tool calls as `tool-call` chunks. */
export function emitToolCallChunks(
  toolCalls: LanguageModelV4ToolCall[],
  controller: TransformStreamDefaultController<LanguageModelV4StreamPart>
): void {
  toolCalls.forEach((toolCall) => {
    controller.enqueue({
      type: 'tool-call',
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      input: toolCall.input
    } as any);
  });
}

/** Emit leftover prose as a `text-delta` on a text part that is still open. */
export function emitRemainingText(
  text: string | undefined,
  controller: TransformStreamDefaultController<LanguageModelV4StreamPart>,
  id: string
): void {
  if (text) {
    controller.enqueue({
      type: 'text-delta',
      delta: text,
      id
    });
  }
}

/**
 * Emits text as a COMPLETE synthetic text part (start + delta + end) under a fresh id. Required for
 * any text produced at finish time: the AI SDK v6 output pipeline turns a `text-delta` whose id has
 * no open text part into an error part and drops the text, so a finish-time emitter must open and
 * close its own part rather than reuse a block id whose `text-end` already passed through.
 */
export function emitTextBlock(
  text: string | undefined,
  controller: TransformStreamDefaultController<LanguageModelV4StreamPart>,
  id: string
): void {
  if (!text) return;
  controller.enqueue({ type: 'text-start', id } as any);
  controller.enqueue({ type: 'text-delta', delta: text, id });
  controller.enqueue({ type: 'text-end', id } as any);
}
