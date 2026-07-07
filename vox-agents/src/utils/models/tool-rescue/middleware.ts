/**
 * @module utils/models/tool-rescue/middleware
 *
 * AI SDK middleware that wires the prompt-shaping and text-extraction halves
 * together. In `prompt` mode it injects a JSON-format instruction before the
 * model runs; on the way out it inspects text content and rescues any JSON
 * tool calls the model emitted instead of using native tool-calling.
 */

import { type LanguageModelMiddleware } from 'ai';
import type {
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolCall,
} from '@ai-sdk/provider';
import { createLogger } from '../../logger.js';
import type { ToolRescueOptions } from './types.js';
import { createToolPrompts, convertPromptToolMessagesToText, reframeToolWording, buildToolCallArraySchema } from './prompt.js';
import { rescueToolCallsFromText, isStructuredOutputToolName } from './extract.js';
import { normalizeKeysToSchema, type JsonSchemaNode } from '../../tools/normalize-keys.js';

const logger = createLogger("tool-rescue");

/** A tool-call part's `input` is normally a JSON string, but guard against an object form. */
function toolInputToString(input: unknown): string {
  return typeof input === 'string' ? input : JSON.stringify(input ?? {});
}

/** Comparison key for a rescued or native tool call: name plus its serialized input. */
function toolCallKey(toolCall: { toolName: string; input: unknown }): string {
  return `${toolCall.toolName}:${toolInputToString(toolCall.input)}`;
}

/** Identifies whether a rescued payload came from ordinary model text or the carrier channel. */
type ToolCallSource = 'text' | 'carrier';

/** State shared by text and carrier recovery for one model response. */
interface ToolCallRecoveryState {
  textCallCounts: Map<string, number>;
}

/** Creates empty source-aware recovery state for one model response. */
function createToolCallRecoveryState(): ToolCallRecoveryState {
  return { textCallCounts: new Map() };
}

/**
 * Rescues calls from one payload and reconciles the two transport sources. Text is authoritative:
 * every call it contains survives, including identical calls split across separate text blocks.
 * Carrier calls are compared by multiplicity against calls already recovered from text, so only
 * the carrier copies are removed while any additional calls remain available as fallback recovery.
 */
function recoverToolCalls(
  payload: string,
  source: ToolCallSource,
  availableTools: Set<string>,
  toolSchemas: Map<string, JsonSchemaNode>,
  state: ToolCallRecoveryState,
  useJaison: boolean = true
): ReturnType<typeof rescueToolCallsFromText> {
  const processed = rescueToolCallsFromText(payload, availableTools, useJaison, toolSchemas);
  if (source === 'text') {
    for (const call of processed.toolCalls) {
      const key = toolCallKey(call);
      state.textCallCounts.set(key, (state.textCallCounts.get(key) ?? 0) + 1);
    }
    return processed;
  }

  const carrierCounts = new Map<string, number>();
  const toolCalls = processed.toolCalls.filter((call) => {
    const key = toolCallKey(call);
    const occurrence = (carrierCounts.get(key) ?? 0) + 1;
    carrierCounts.set(key, occurrence);
    return occurrence > (state.textCallCounts.get(key) ?? 0);
  });
  return { ...processed, toolCalls };
}

/**
 * True when a native tool-call name is the StructuredOutput carrier we installed for a
 * constrained-decoding provider: enabled for this call (`active`), not one of the game tools,
 * and matching the carrier name. `active` reflects whether transformParams actually set our
 * `responseFormat` (not merely the config flag), so a step carrying a genuine `output` schema
 * keeps its structured output instead of having it suppressed as a phantom carrier.
 */
function isCarrierToolName(name: string, toolNames: Set<string>, active: boolean | undefined): boolean {
  return !!active && !toolNames.has(name) && isStructuredOutputToolName(name);
}

/**
 * Maps each function tool's canonical name to its full JSON Schema, so both the rescue path and the
 * native pass can realign the model's argument-key casing to the declared casing at every nesting
 * level (e.g. `message` → `Message`, or `Give:[{term}]` → `Give:[{Term}]`).
 */
function buildToolSchemaMap(tools: readonly any[] | undefined): Map<string, JsonSchemaNode> {
  const map = new Map<string, JsonSchemaNode>();
  for (const tool of tools ?? []) {
    const schema = tool?.type === 'function' ? tool.inputSchema : undefined;
    if (schema && typeof schema === 'object') map.set(tool.name, schema);
  }
  return map;
}

/**
 * Realign a native game tool-call part's argument-key casing to its schema before it reaches the AI
 * SDK's validator. Native calls bypass the text-rescue path entirely, so without this a lowercase
 * `term`/`amount` (or nested `Give:[{term}]`) fails validation for otherwise-valid input. Returns the
 * original part unchanged when there is no schema, the input can't be parsed, or nothing was renamed
 * (identity-preserving), so a genuine call is never rewritten or re-encoded.
 */
function normalizeToolCallPartKeys<T extends { input?: unknown }>(
  part: T,
  schema: JsonSchemaNode | undefined
): T {
  if (!schema) return part;
  const raw = part.input;
  let parsed: unknown;
  if (raw && typeof raw === 'object') {
    parsed = raw;
  } else if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return part; }
  } else {
    return part;
  }
  const normalized = normalizeKeysToSchema(parsed, schema);
  if (normalized === parsed) return part;
  // Preserve the original input encoding: an object stays an object, a JSON string stays a string.
  return { ...part, input: typeof raw === 'string' ? JSON.stringify(normalized) : normalized };
}

/**
 * Emits rescued tool calls as stream chunks
 * @param toolCalls Array of rescued tool calls
 * @param controller Transform stream controller
 */
function emitToolCallChunks(
  toolCalls: LanguageModelV3ToolCall[],
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>
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

/**
 * Emits remaining text as a text-delta chunk
 * @param text Remaining text to emit
 * @param controller Transform stream controller
 * @param id Optional chunk ID
 */
function emitRemainingText(
  text: string | undefined,
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
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
 * Creates a tool rescue middleware for language models.
 * This middleware intercepts generate operations to detect and transform
 * JSON tool calls embedded in text responses into proper tool-call format.
 *
 * @param options Configuration options
 * @returns A LanguageModelMiddleware that handles tool rescue
 */
export function toolRescueMiddleware(options?: ToolRescueOptions): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3' as const,

    // Transform params if prompt mode is enabled
    transformParams: async ({ params }) => {
      // Skip if prompt mode not enabled or no tools
      if (!options?.prompt || !params?.tools || params.tools.length === 0) {
        return params;
      }

      const framing = options?.framing ?? 'tool';
      const toolChoice = params.toolChoice ?? { type: "auto" };

      // Single source of truth for whether constrained decoding will FORCE the tool-call wrapper
      // object. Drives BOTH the injected prompt shape (so the taught example matches) and the
      // responseFormat schema below, so the instruction and the grammar can never diverge.
      const wrapToolCalls = !!options?.structuredToolCalls
        && toolChoice.type === 'required'
        && !params.responseFormat;

      // Create tool instruction prompt with full tool schemas
      const toolPrompt = createToolPrompts(params.tools, toolChoice, framing, wrapToolCalls);

      // Report the resolved framing as an explicit fact, recorded separately from any prompt
      // content. Recording the framing value (not the mere presence of a stored prompt) keeps
      // future prompt-storage changes from silently altering how a turn's framing reads. The
      // injected prompt itself is deliberately NOT recorded: replay reconstructs it from the
      // replay model's own framing/convention, so faithful reproduction comes from modelOverride
      // returning a CC/options.framing model, not from stored prompt telemetry.
      if (options?.onToolFraming) {
        options.onToolFraming({ framing });
      }

      // For a constrained-decoding provider (claude-code) with forced tool use, pin the
      // reply to the tool-call array contour so the rescue below parses schema-valid text
      // instead of best-effort free text. The injected prompt above still stands (semantic
      // guidance + prose fallback). Respect a responseFormat a real output schema already
      // set (streamText lowers `output` to params.responseFormat), so never clobber it, and
      // mark that we installed ours so the carrier suppression below only fires for our schema.
      if (wrapToolCalls) {
        params.responseFormat = { type: 'json', schema: buildToolCallArraySchema(params.tools, framing) };
        (params as any).structuredToolCallsActive = true;
      }

      // Convert existing tool-call/tool-result messages to text so the model
      // sees a consistent text-based history instead of native tool parts it never produced.
      // Pass wrapToolCalls so the echoed prior calls take the SAME wrapper-object shape the
      // injected instruction (line 201) and responseFormat schema (line 220) use, instead of a
      // bare array that would contradict them and confuse a weak prompt-mode model.
      let convertedPrompt = convertPromptToolMessagesToText(params.prompt ?? [], framing, wrapToolCalls);

      // Uniformly reword agent-authored system prose to match the action framing.
      // Confined to system messages; the protocol block (toolPrompt) is already
      // action-framed by construction and is inserted below untouched.
      if (framing === 'action') {
        convertedPrompt = convertedPrompt.map(message =>
          message.role === 'system'
            ? { ...message, content: reframeToolWording(message.content) }
            : message
        );
      }

      // Build the modified prompt. Where the protocol block lands depends on framing:
      //  - 'action' (claude-code): insert it right before the first user message, so the
      //    action instructions sit adjacent to the turn the model is asked to act on rather
      //    than buried above the leading system prose. Falls back to the front when the
      //    conversation carries no user message yet (a leading system message is always valid).
      //  - systemPromptFirst models (only accept a single system message at position 0, e.g.
      //    Qwen): merge the tool prompt into the first existing system message.
      //  - otherwise: prepend a new leading system message.
      let modifiedPrompt: LanguageModelV3Prompt;
      if (!toolPrompt) {
        modifiedPrompt = convertedPrompt;
      } else if (framing === 'action') {
        const firstUserIdx = convertedPrompt.findIndex(m => m.role === 'user');
        const insertAt = firstUserIdx === -1 ? 0 : firstUserIdx;
        modifiedPrompt = [
          ...convertedPrompt.slice(0, insertAt),
          { role: 'system', content: toolPrompt },
          ...convertedPrompt.slice(insertAt),
        ];
      } else if (options?.systemPromptFirst && convertedPrompt.length > 0 && convertedPrompt[0].role === 'system') {
        const firstMsg = convertedPrompt[0] as { role: 'system'; content: string };
        modifiedPrompt = [
          { role: 'system', content: toolPrompt + '\n\n' + firstMsg.content },
          ...convertedPrompt.slice(1)
        ];
      } else {
        modifiedPrompt = [
          { role: 'system', content: toolPrompt },
          ...convertedPrompt
        ];
      }

      // Return modified params without tools (since we're using JSON format)
      const newParams: any = params;
      newParams.originalTools = params.tools;
      newParams.tools = undefined;
      newParams.prompt = modifiedPrompt;
      return newParams;
    },

    wrapGenerate: async ({ doGenerate, params }) => {
      try {
        // Execute the generation (params were already transformed if needed)
        const result = await doGenerate();
        params.tools = params.tools ?? (params as any).originalTools;

        // Whether transformParams installed our StructuredOutput responseFormat for this call.
        // Gating carrier handling on this (not merely the config flag) keeps a step that carries
        // a genuine `output` schema from having its real structured output suppressed.
        const structuredActive = (params as any).structuredToolCallsActive;

        // Extract tool names from the tool definitions
        const toolNames = params.tools ? new Set(params.tools.map((tool) => tool.name)) : new Set<string>();
        const toolSchemas = buildToolSchemaMap(params.tools);

        // Native pass: genuine game tool-call parts bypass the text-rescue path below, so realign
        // their argument-key casing to the schema here (nested keys included) before the AI SDK
        // validates them. Identity-preserving, so a correct call keeps its exact original part.
        result.content = result.content.map((content) =>
          content.type === "tool-call" && toolNames.has(content.toolName)
            ? normalizeToolCallPartKeys(content, toolSchemas.get(content.toolName))
            : content
        );

        // Rescue tool calls from JSON text if we have tools but no *game* tool call yet.
        // We can't bail on any tool-call part existing: under constrained decoding the
        // claude-code StructuredOutput carrier arrives as a native tool-call part that carries
        // our `{ actions: [...] }` wrapper, so the real game call is still hiding in text (or in
        // that carrier's own input). Only a genuine game tool call means there's nothing to do.
        const hasGameToolCall = result.content.some(
          content => content.type === "tool-call" && toolNames.has(content.toolName)
        );
        if (!hasGameToolCall && params.tools && params.tools.length > 0) {
          const newContents: typeof result.content = [];
          const rescuedCalls: LanguageModelV3ToolCall[] = [];
          const recoveryState = createToolCallRecoveryState();
          const carrierParts: LanguageModelV3ToolCall[] = [];

          for (const content of result.content) {
            if (content.type === "text") {
              const processed = recoverToolCalls(content.text, 'text', toolNames, toolSchemas, recoveryState);
              rescuedCalls.push(...processed.toolCalls);
              // Honor remainingText per rescueToolCallsFromText's contract: byte-identical means
              // untouched prose (keep the original part), anything else means a call or wrapper
              // husk was consumed (push the remainder, or drop the part when nothing is left).
              if (processed.remainingText === content.text) newContents.push(content);
              else if (processed.remainingText) newContents.push({ type: 'text', text: processed.remainingText });
              continue;
            }
            // Drop the StructuredOutput carrier; its `{ actions: [...] }` payload is rescued
            // (from text above, or from its own input as a fallback below).
            if (content.type === "tool-call" && isCarrierToolName(content.toolName, toolNames, structuredActive)) {
              carrierParts.push(content);
              continue;
            }
            newContents.push(content);
          }

          // Reconcile every carrier after text has established the authoritative call counts.
          // Identical carrier copies disappear, while carrier-only or additional calls survive.
          for (const carrier of carrierParts) {
            const processed = recoverToolCalls(
              toolInputToString(carrier.input),
              'carrier',
              toolNames,
              toolSchemas,
              recoveryState
            );
            rescuedCalls.push(...processed.toolCalls);
          }

          if (rescuedCalls.length > 0) {
            newContents.push(...rescuedCalls);
            result.finishReason = { unified: 'tool-calls', raw: result.finishReason?.raw };
          } else if (carrierParts.length > 0) {
            // Carrier(s) were suppressed but nothing rescued from any channel. Rather than return an
            // empty turn (a silent no-op step downstream), surface the raw carrier payload as text so
            // the failure is visible and recoverable instead of vanishing.
            logger.log("warn", "structuredToolCalls carrier produced no rescuable tool call; preserving payload as text");
            for (const carrier of carrierParts) {
              newContents.push({ type: 'text', text: toolInputToString(carrier.input) });
            }
          }

          // Update result with new contents
          result.content = newContents;
        }

        return result;
      } catch (error) {
        // Re-throw the error to let the retry mechanism handle it
        logger.error("Error in wrapGenerate middleware, passing down");
        // Preserve context length errors so they survive the AI SDK's error wrapping
        ((params as any).providerOptions ??= {}).error = error;
        throw error;
      }
    },

    wrapStream: async ({ doStream, params }) => {
      try {
        const { stream, ...rest } = await doStream();
        params.tools = params.tools ?? (params as any).originalTools;

        // If we don't have tools, just pass through the stream
        if (!params.tools || params.tools.length === 0) {
          return { stream, ...rest };
        }

        // Whether transformParams installed our StructuredOutput responseFormat for this call;
        // gates carrier suppression so a genuine `output` schema survives (see wrapGenerate).
        const structuredActive = (params as any).structuredToolCallsActive;

        // Extract tool names from the tool definitions
        const toolNames = new Set(params.tools.map((tool) => tool.name));
        const toolSchemas = buildToolSchemaMap(params.tools);

        // Track if we've already found tool calls
        let toolCallsFound = false;
        // Buffer for incomplete JSON
        let incompleteBuffers: Record<string, string> = {};
        // IDs of StructuredOutput carrier tool blocks to suppress. Under constrained decoding the
        // carrier's `{ actions: [...] }` payload is diverted to text (rescued by the text path),
        // and the empty carrier tool-call must not leak downstream as an unknown tool.
        const carrierIds = new Set<string>();
        // Accumulated input deltas per carrier id, used as a recovery fallback if the terminal
        // tool-call chunk arrives without its assembled input.
        const carrierBuffers: Record<string, string> = {};
        // Reconcile carrier copies against text without deduping calls within or across text blocks.
        const recoveryState = createToolCallRecoveryState();
        // Defer carrier recovery until finish so later text blocks remain authoritative regardless
        // of whether the provider emits the carrier before or after its text representation.
        const pendingCarrierPayloads: Array<{ payload: string; id: string }> = [];

        const transformStream = new TransformStream<
          LanguageModelV3StreamPart,
          LanguageModelV3StreamPart
        >({
          transform(chunk, controller) {
            switch (chunk.type) {
              case "text-delta": {
                // Process the incoming delta
                let incompleteBuffer = incompleteBuffers[chunk.id] ?? "";
                let currentDelta = incompleteBuffer + chunk.delta;

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

                  if (!incompleteBuffer.startsWith('```json')) {
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
                      // Every text-authored call is authoritative, including identical repeats.
                      emitToolCallChunks(processed.toolCalls, controller);
                      toolCallsFound = true;
                      // Clear the buffer and put remaining text there
                      let remaining = processed.remainingText ?? "";
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
                let incompleteBuffer = incompleteBuffers[chunk.id] ?? "";
                if (incompleteBuffer !== "") {
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
                    // Every text-authored call is authoritative, including identical repeats.
                    emitToolCallChunks(processed.toolCalls, controller);
                    toolCallsFound = true;
                  }
                }
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
                  // Nothing was rescued from either source: preserve carrier payloads as text
                  // rather than turning the model response into a silent no-op.
                  logger.log("warn", "structuredToolCalls carrier produced no rescuable tool call; preserving payload as text");
                  for (const pending of unrescuedCarrierPayloads) {
                    emitRemainingText(pending.payload, controller, pending.id);
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
          }
        });

        return {
          stream: stream.pipeThrough(transformStream),
          ...rest,
        };
      } catch (error) {
        // Re-throw the error to let the retry mechanism handle it
        logger.error("Error in wrapStream middleware, passing down");
        // Preserve context length errors so they survive the AI SDK's error wrapping
        ((params as any).providerOptions ??= {}).error = error;
        throw error;
      }
    }
  };
}
