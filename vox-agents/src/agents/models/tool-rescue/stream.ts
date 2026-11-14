/**
 * @module agents/models/tool-rescue/stream
 *
 * The streaming outbound half: rescue tool calls out of text while it is still arriving.
 *
 * Harder than its `./generate.ts` counterpart for one reason: the decision to commit a call has to
 * be made without having seen the rest of the response. So text from the first JSON marker onward is
 * diverted into a per-block buffer, a strict parse is retried as it grows, and whatever is left is
 * resolved leniently at `text-end`. The rules it shares with the non-streaming half live in
 * `./recovery.ts`.
 *
 * Alongside that, `./tool-input-stream.ts` forwards a whitelisted tool's arguments live out of the
 * same buffer, so a spoken reply is not withheld until its JSON closes.
 */

import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { ToolRescueOptions } from './types.js';
import {
  buildToolSchemaMap,
  normalizeToolCallPartKeys,
  recoverToolCalls,
} from './recovery.js';
import { emitRemainingText, emitToolCallChunks } from './stream-parts.js';
import { createToolInputStreamer } from './tool-input-stream.js';

/** Build the transform that rescues tool calls out of one model response stream. */
export function createRescueTransform(
  params: LanguageModelV4CallOptions,
  options?: ToolRescueOptions
): TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart> {
  // Extract tool names from the tool definitions
  const toolNames = new Set(params.tools!.map((tool) => tool.name));
  const toolSchemas = buildToolSchemaMap(params.tools);

  // Track if we've already found tool calls
  let toolCallsFound = false;
  // Buffer for incomplete JSON
  const incompleteBuffers: Record<string, string> = {};

  // Live forwarding of a whitelisted tool's arguments. Off for a native tool-caller, whose
  // provider already streams its own tool input; see createToolInputStreamer.
  const toolInput = createToolInputStreamer(!!options?.prompt, toolNames);

  return new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
    transform(chunk, controller) {
      switch (chunk.type) {
        case "text-delta": {
          // Process the incoming delta
          let incompleteBuffer = incompleteBuffers[chunk.id] ?? "";
          const currentDelta = incompleteBuffer + chunk.delta;

          // Check for JSON start characters and delimiter-based tool call markers
          const objStartIndex = currentDelta.indexOf('{');
          const arrStartIndex = currentDelta.indexOf('[');
          const markdownStartIndex = currentDelta.indexOf('```json');
          const delimiterStartIndex = currentDelta.indexOf('<|tool_call');
          let jsonStartIndex = -1;

          // Find the earliest occurrence of any start marker
          const candidates = [
            markdownStartIndex,
            objStartIndex,
            arrStartIndex,
            delimiterStartIndex
          ].filter(i => i !== -1);

          if (candidates.length > 0) {
            jsonStartIndex = Math.min(...candidates);
          } else {
            chunk.delta = currentDelta;
          }

          if (jsonStartIndex !== -1) {
            // Output text before JSON, start buffering from JSON
            chunk.delta = currentDelta.substring(0, jsonStartIndex);
            incompleteBuffer = currentDelta.substring(jsonStartIndex);

            // Forward a whitelisted tool's arguments as they accumulate, BEFORE the rescue below
            // can emit the call that closes this stream — a delta arriving after its own tool-call
            // would find no open stream downstream and leak as raw JSON. Sits outside the fence
            // check below on purpose: whether the call is committed here or at text-end says
            // nothing about whether its arguments can already be spoken.
            toolInput.pump(chunk.id, incompleteBuffer, controller);

            if (!incompleteBuffer.startsWith('```json')) {
              // Try to rescue tool calls from accumulated buffer - strict first
              const processed = recoverToolCalls(
                incompleteBuffer,
                toolNames,
                toolSchemas,
                false
              );
              if (processed.toolCalls.length > 0) {
                // Bind before emitting: the rescued call has to carry the streamed id.
                if (!toolInput.finalize(chunk.id, processed.toolCalls, controller, true)) {
                  // Nothing bound, yet the buffer is about to be rewritten below, which invalidates
                  // the stream's offset. Park it so it stays bindable at text-end instead of being
                  // re-opened as a duplicate against the new buffer.
                  toolInput.stale(chunk.id);
                }
                // Every text-authored call is authoritative, including identical repeats.
                emitToolCallChunks(processed.toolCalls, controller);
                toolCallsFound = true;
                // Clear the buffer and put remaining text there
                const remaining = processed.remainingText ?? "";
                if (remaining.indexOf("{") !== -1 || remaining.indexOf("<|tool_call") !== -1)
                  incompleteBuffers[chunk.id] = remaining;
                else {
                  incompleteBuffers[chunk.id] = "";
                  chunk.delta += remaining;
                }
              } else {
                incompleteBuffers[chunk.id] = incompleteBuffer;
              }
            } else {
              incompleteBuffers[chunk.id] = incompleteBuffer;
            }
          }

          // Pass through the remaining text
          controller.enqueue(chunk);
          break;
        }
        case "text-end": {
          // Text block ended, pass through
          const incompleteBuffer = incompleteBuffers[chunk.id] ?? "";
          if (incompleteBuffer !== "") {
            // More lenient when the stream is finishing
            const processed = recoverToolCalls(
              incompleteBuffer,
              toolNames,
              toolSchemas
            );
            // Honor remainingText per rescueToolCallsFromText's contract: unchanged for
            // genuine prose, stripped when a call or wrapper shell was consumed. Emitted
            // before any tool calls so leading prose precedes them in the stream.
            emitRemainingText(processed.remainingText, controller, chunk.id);
            if (processed.toolCalls.length > 0) {
              // Bind before emitting: the rescued call has to carry the streamed id.
              toolInput.finalize(chunk.id, processed.toolCalls, controller);
              // Every text-authored call is authoritative, including identical repeats.
              emitToolCallChunks(processed.toolCalls, controller);
              toolCallsFound = true;
            }
          }
          // Idempotent: closes a stream this block opened but never bound, so no synthetic
          // stream outlives the text block it belongs to.
          toolInput.finalize(chunk.id, [], controller);
          controller.enqueue(chunk);
          break;
        }
        case "tool-call": {
          // Genuine native tool call: realign its argument-key casing to the schema (nested
          // keys included) before it streams on to the AI SDK's validator. No-op for a
          // correctly-cased call, so the chunk passes through untouched.
          controller.enqueue(normalizeToolCallPartKeys(chunk, toolSchemas.get(chunk.toolName)));
          break;
        }
        case "finish": {
          // Close any stream whose text block never ended (a truncated response), so an open
          // synthetic stream can never outlive the response that opened it.
          toolInput.closeAll(controller);
          // Update finish reason if we found tool calls
          if (toolCallsFound) {
            controller.enqueue({
              ...chunk,
              finishReason: { unified: 'tool-calls', raw: chunk.finishReason?.raw }
            });
          } else {
            controller.enqueue(chunk);
          }
          break;
        }

        default: {
          // Pass through other chunks unchanged
          controller.enqueue(chunk);
          break;
        }
      }
    },
    flush(controller) {
      // Last resort for a stream that closes without a finish chunk at all.
      toolInput.closeAll(controller);
    }
  });
}
