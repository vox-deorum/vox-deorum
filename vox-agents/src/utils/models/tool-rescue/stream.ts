/**
 * @module utils/models/tool-rescue/stream
 *
 * The streaming outbound half: rescue tool calls out of text while it is still arriving.
 *
 * Harder than its `./generate.ts` counterpart for one reason — the decision to commit a call has to
 * be made without having seen the rest of the response. So text from the first JSON marker onward is
 * diverted into a per-block buffer, a strict parse is retried as it grows, and whatever is left is
 * resolved leniently at `text-end` (or, under constrained decoding, at `finish`, where competing
 * attempts are ranked). The rules it shares with the non-streaming half live in `./recovery.ts`.
 *
 * Alongside that, `./tool-input-stream.ts` forwards a whitelisted tool's arguments live out of the
 * same buffer, so a spoken reply is not withheld until its JSON closes.
 */

import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { createLogger } from '../../logger.js';
import type { ToolRescueOptions } from './types.js';
import { rescueToolCallsFromText } from './extract.js';
import {
  buildToolSchemaMap,
  classifyStructuredAttempt,
  createToolCallRecoveryState,
  isCarrierToolName,
  lastAttemptWinnerIdx,
  normalizeToolCallPartKeys,
  recordTextToolCalls,
  recoverToolCalls,
  toolInputToString,
} from './recovery.js';
import { emitRemainingText, emitTextBlock, emitToolCallChunks } from './stream-parts.js';
import { createToolInputStreamer } from './tool-input-stream.js';

const logger = createLogger("tool-rescue");

/** Build the transform that rescues tool calls out of one model response stream. */
export function createRescueTransform(
  params: LanguageModelV4CallOptions,
  options?: ToolRescueOptions
): TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart> {
  // Whether transformParams installed our StructuredOutput responseFormat for this call;
  // gates carrier suppression so a genuine `output` schema survives (see the generate half).
  const structuredActive = (params as any).structuredToolCallsActive;

  // Extract tool names from the tool definitions
  const toolNames = new Set(params.tools!.map((tool) => tool.name));
  const toolSchemas = buildToolSchemaMap(params.tools);

  // Track if we've already found tool calls
  let toolCallsFound = false;
  // Buffer for incomplete JSON
  const incompleteBuffers: Record<string, string> = {};
  // IDs of StructuredOutput carrier tool blocks to suppress. Under constrained decoding the
  // carrier's `{ actions: [...] }` payload is diverted to text (rescued by the text path),
  // and the empty carrier tool-call must not leak downstream as an unknown tool.
  const carrierIds = new Set<string>();
  // Accumulated input deltas per carrier id, used as a recovery fallback if the terminal
  // tool-call chunk arrives without its assembled input.
  const carrierBuffers: Record<string, string> = {};
  // Reconcile carrier copies against the single winning text attempt (structured mode) or
  // against every text call (free-text mode); see recoverToolCalls / the finish handler.
  const recoveryState = createToolCallRecoveryState();
  // Defer carrier recovery until finish so later text blocks remain authoritative regardless
  // of whether the provider emits the carrier before or after its text representation.
  const pendingCarrierPayloads: Array<{ payload: string; id: string }> = [];
  // Structured mode only: each text block is a StructuredOutput ATTEMPT. The CLI validates the
  // forced tool input and retries rejected attempts within the same response, so only the last
  // attempt is accepted. Buffer each block's JSON here instead of rescuing eagerly at text-end,
  // and resolve last-attempt-wins at finish (before carrier reconciliation).
  const structuredBlocks: Array<{ id: string; buffer: string }> = [];

  // Live forwarding of a whitelisted tool's arguments. Off for a native tool-caller (the provider
  // already streams its own tool input) and off under constrained decoding (a block may be an
  // attempt the CLI rejects and retries); see createToolInputStreamer for why each matters.
  const toolInput = createToolInputStreamer(!!options?.prompt && !structuredActive, toolNames);

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

            // In structured mode never rescue mid-block: this text is one StructuredOutput
            // attempt whose CLI verdict isn't known yet (even valid JSON can be schema-rejected
            // and retried), so defer the whole buffer to the text-end stash / finish resolution.
            if (!structuredActive && !incompleteBuffer.startsWith('```json')) {
              // Try to rescue tool calls from accumulated buffer - strict first
              const processed = recoverToolCalls(
                incompleteBuffer,
                'text',
                toolNames,
                toolSchemas,
                recoveryState,
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
            if (structuredActive) {
              // Defer: this block is one StructuredOutput attempt. Stash its JSON and let the
              // finish handler commit only the last call-yielding attempt (last-attempt-wins),
              // so a rejected-then-retried attempt cannot execute alongside the accepted one.
              structuredBlocks.push({ id: chunk.id, buffer: incompleteBuffer });
              incompleteBuffers[chunk.id] = "";
            } else {
              // More lenient when the stream is finishing
              const processed = recoverToolCalls(
                incompleteBuffer,
                'text',
                toolNames,
                toolSchemas,
                recoveryState
              );
              // Honor remainingText per rescueToolCallsFromText's contract: unchanged for
              // genuine prose, stripped when a call or wrapper husk was consumed. Emitted
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
          }
          // Idempotent: closes a stream this block opened but never bound, so no synthetic
          // stream outlives the text block it belongs to.
          toolInput.finalize(chunk.id, [], controller);
          controller.enqueue(chunk);
          break;
        }
        case "tool-input-start": {
          // Begin suppressing a StructuredOutput carrier block (start + deltas + end + call).
          if (isCarrierToolName((chunk as any).toolName, toolNames, structuredActive)) {
            carrierIds.add(chunk.id);
            break; // drop
          }
          controller.enqueue(chunk);
          break;
        }
        case "tool-input-delta": {
          // Buffer (rather than forward) the carrier's input deltas, so its payload can still
          // be recovered if the terminal tool-call chunk arrives without assembled input.
          if (carrierIds.has(chunk.id)) {
            carrierBuffers[chunk.id] = (carrierBuffers[chunk.id] ?? "") + ((chunk as any).delta ?? "");
            break;
          }
          controller.enqueue(chunk);
          break;
        }
        case "tool-input-end": {
          // Drop the carrier's input-end chunk (payload handled via text or the buffer above).
          if (carrierIds.has(chunk.id)) break;
          controller.enqueue(chunk);
          break;
        }
        case "tool-call": {
          const isCarrier = carrierIds.has((chunk as any).toolCallId)
            || isCarrierToolName(chunk.toolName, toolNames, structuredActive);
          if (isCarrier) {
            // Fallback: unwrap the carrier's wrapper input (or the buffered deltas) when the
            // diverted text didn't already produce the game call. Then drop the carrier.
            let inputStr = toolInputToString((chunk as any).input);
            if (!inputStr.trim() || inputStr.trim() === "{}") {
              const buffered = carrierBuffers[(chunk as any).toolCallId];
              if (buffered && buffered.trim()) inputStr = buffered;
            }
            if (inputStr.trim() && inputStr.trim() !== "{}") {
              pendingCarrierPayloads.push({
                payload: inputStr,
                id: (chunk as any).toolCallId,
              });
            }
            break; // drop the carrier tool-call
          }
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
          // Resolve stashed StructuredOutput attempts FIRST (last-attempt-wins), so only the
          // accepted attempt's calls populate the recovery state and its carrier copy is the
          // one carrier reconciliation below dedups.
          if (structuredBlocks.length > 0) {
            const rescues = structuredBlocks.map((block) =>
              rescueToolCallsFromText(block.buffer, toolNames, true, toolSchemas));
            const winnerIdx = lastAttemptWinnerIdx(rescues);
            for (let i = 0; i < structuredBlocks.length; i++) {
              const processed = rescues[i];
              const rescuedId = `${structuredBlocks[i].id}-rescued`;
              switch (classifyStructuredAttempt(processed, i, winnerIdx)) {
                case 'winner':
                  recordTextToolCalls(processed.toolCalls, recoveryState);
                  emitTextBlock(processed.remainingText, controller, rescuedId);
                  emitToolCallChunks(processed.toolCalls, controller);
                  toolCallsFound = true;
                  break;
                case 'superseded':
                  // A rejected-then-retried attempt: its call must never run, and its mangled
                  // JSON must not surface as assistant text. Drop it (logged).
                  logger.log("warn",
                    `dropping superseded StructuredOutput attempt (${processed.toolCalls.length} call(s)): ${structuredBlocks[i].buffer.slice(0, 200)}`);
                  break;
                case 'prose':
                  // A call-free block (nothing validated, or a trailing note after the winner):
                  // keep genuine prose visible; a wrapper husk comes back empty and drops itself.
                  emitTextBlock(processed.remainingText, controller, rescuedId);
                  break;
              }
            }
          }
          const unrescuedCarrierPayloads: Array<{ payload: string; id: string }> = [];
          for (const pending of pendingCarrierPayloads) {
            const processed = recoverToolCalls(
              pending.payload,
              'carrier',
              toolNames,
              toolSchemas,
              recoveryState
            );
            if (processed.toolCalls.length > 0) {
              emitToolCallChunks(processed.toolCalls, controller);
              toolCallsFound = true;
            } else {
              unrescuedCarrierPayloads.push(pending);
            }
          }
          if (!toolCallsFound && unrescuedCarrierPayloads.length > 0) {
            // Nothing was rescued from any source: preserve carrier payloads as text (a complete
            // synthetic part) rather than turning the model response into a silent no-op.
            logger.log("warn", "structuredToolCalls carrier produced no rescuable tool call; preserving payload as text");
            for (const pending of unrescuedCarrierPayloads) {
              emitTextBlock(pending.payload, controller, `${pending.id}-preserved`);
            }
          }
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
