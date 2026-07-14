/**
 * @module utils/models/tool-rescue/middleware
 *
 * AI SDK middleware that wires the prompt-shaping and text-extraction halves
 * together. In `prompt` mode it injects a JSON-format instruction before the
 * model runs; on the way out it inspects text content and rescues any JSON
 * tool calls the model emitted instead of using native tool-calling.
 *
 * Under `structuredToolCalls` (the claude-code constrained-decoding path) the CLI strictly
 * validates each forced-tool attempt and retries a rejected one within the same response, so
 * separate text blocks are competing ATTEMPTS at one output rather than independent calls. In that
 * mode the rescue is last-attempt-wins: only the final call-yielding attempt is committed. Free-text
 * prompt mode keeps its original semantics, where every text-authored call survives (repeats included).
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
import { preserveModelError } from '../preserved-model-error.js';

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
 * Records text-sourced tool calls into the recovery state's multiplicity map, so a later carrier
 * reconciliation subtracts exactly the copies text already accounted for. Split out of
 * recoverToolCalls so the structured-mode finish path can register only the winning attempt's
 * calls (see the last-attempt-wins handling in wrapStream/wrapGenerate).
 */
function recordTextToolCalls(
  toolCalls: readonly LanguageModelV3ToolCall[],
  state: ToolCallRecoveryState
): void {
  for (const call of toolCalls) {
    const key = toolCallKey(call);
    state.textCallCounts.set(key, (state.textCallCounts.get(key) ?? 0) + 1);
  }
}

/**
 * The disposition of one StructuredOutput retry attempt under last-attempt-wins: the accepted
 * `'winner'` whose calls are committed, a `'superseded'` earlier attempt the CLI rejected and
 * retried (dropped so it can't execute a second call), or `'prose'` — a call-free block that is
 * genuine model text, surfaced via the remainingText contract rather than dropped.
 */
type StructuredAttemptDisposition = 'winner' | 'superseded' | 'prose';

/**
 * Index of the winning attempt: the LAST rescue that yields any call (the CLI accepts the final
 * retry), or -1 when nothing validated. Accepts a sparse array so wrapGenerate can pass rescues
 * aligned to `result.content` with `undefined` for its non-text parts.
 */
function lastAttemptWinnerIdx(
  rescues: ReadonlyArray<{ toolCalls: readonly unknown[] } | undefined>
): number {
  return rescues.reduce((acc, r, i) => (r && r.toolCalls.length > 0 ? i : acc), -1);
}

/**
 * Classifies one attempt for last-attempt-wins. Only a call-yielding non-winner is a superseded
 * retry to drop; every call-free block is prose (kept via remainingText), so genuine text — leading
 * or trailing — is never mistaken for a rejected attempt. Sole resolver for BOTH transports, so
 * wrapGenerate and wrapStream cannot drift on which attempt wins or what happens to prose.
 */
function classifyStructuredAttempt(
  rescue: { toolCalls: readonly unknown[] },
  idx: number,
  winnerIdx: number
): StructuredAttemptDisposition {
  if (idx === winnerIdx) return 'winner';
  if (rescue.toolCalls.length > 0) return 'superseded';
  return 'prose';
}

/**
 * Rescues calls from one payload and reconciles the two transport sources.
 *
 * In free-text (non-structured) mode, text is authoritative: every call it contains survives,
 * including identical calls split across separate text blocks, and each is counted so carrier
 * copies can be subtracted. Carrier calls are compared by multiplicity against calls already
 * recovered from text, so only the carrier copies are removed while any additional calls remain
 * available as fallback recovery.
 *
 * Under `structuredToolCallsActive`, separate text blocks are instead retry ATTEMPTS at one forced
 * tool output (the CLI validates each and retries rejected ones within the same response), so the
 * callers there do NOT route attempt text through this helper's `'text'` branch; they resolve
 * last-attempt-wins first and register only the winner via recordTextToolCalls before running
 * carrier reconciliation.
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
    recordTextToolCalls(processed.toolCalls, state);
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
 * Emits text as a COMPLETE synthetic text part (start + delta + end) under a fresh id. Required for
 * any text produced at finish time: the AI SDK v6 output pipeline turns a `text-delta` whose id has
 * no open text part into an error part and drops the text, so a finish-time emitter must open and
 * close its own part rather than reuse a block id whose `text-end` already passed through.
 */
function emitTextBlock(
  text: string | undefined,
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  id: string
): void {
  if (!text) return;
  controller.enqueue({ type: 'text-start', id } as any);
  controller.enqueue({ type: 'text-delta', delta: text, id });
  controller.enqueue({ type: 'text-end', id } as any);
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
        //
        // In structured mode each text part is a retry ATTEMPT at the forced output (the CLI
        // validates each and retries rejected ones within one response), so only the LAST
        // call-yielding text part is committed (last-attempt-wins); earlier attempts are dropped.
        // Free-text mode keeps every text call, including identical repeats across parts.
        const hasGameToolCall = result.content.some(
          content => content.type === "tool-call" && toolNames.has(content.toolName)
        );
        if (!hasGameToolCall && params.tools && params.tools.length > 0) {
          const newContents: typeof result.content = [];
          const rescuedCalls: LanguageModelV3ToolCall[] = [];
          const recoveryState = createToolCallRecoveryState();
          const carrierParts: LanguageModelV3ToolCall[] = [];

          // Structured mode: pre-rescue every text part and mark the last call-yielding one as the
          // winner, so the loop commits only its calls. undefined entries are non-text content.
          const structuredTextRescues = structuredActive
            ? result.content.map((content) =>
                content.type === "text"
                  ? rescueToolCallsFromText(content.text, toolNames, true, toolSchemas)
                  : undefined)
            : undefined;
          const structuredWinnerIdx = structuredTextRescues
            ? lastAttemptWinnerIdx(structuredTextRescues)
            : -1;

          // Honor rescueToolCallsFromText's remainingText contract for a text part: byte-identical
          // means untouched prose (keep the original part), a shorter string means a call/husk was
          // consumed (push the remainder), and undefined means nothing meaningful is left (drop it).
          const keepRemainder = (remainingText: string | undefined, original: { text: string }) => {
            if (remainingText === original.text) newContents.push(original as any);
            else if (remainingText) newContents.push({ type: 'text', text: remainingText });
          };

          for (let idx = 0; idx < result.content.length; idx++) {
            const content = result.content[idx];
            if (content.type === "text") {
              const structuredRescue = structuredTextRescues?.[idx];
              if (structuredRescue) {
                switch (classifyStructuredAttempt(structuredRescue, idx, structuredWinnerIdx)) {
                  case 'winner':
                    recordTextToolCalls(structuredRescue.toolCalls, recoveryState);
                    rescuedCalls.push(...structuredRescue.toolCalls);
                    keepRemainder(structuredRescue.remainingText, content);
                    break;
                  case 'superseded':
                    // A rejected-then-retried attempt: drop it entirely so it can't execute a second
                    // call, and don't surface its mangled JSON as assistant text.
                    logger.log("warn",
                      `dropping superseded StructuredOutput attempt (${structuredRescue.toolCalls.length} call(s)): ${content.text.slice(0, 200)}`);
                    break;
                  case 'prose':
                    // A call-free part (leading reasoning, a trailing note, or when nothing
                    // validated): keep genuine prose; a wrapper husk comes back empty and drops itself.
                    keepRemainder(structuredRescue.remainingText, content);
                    break;
                }
                continue;
              }
              const processed = recoverToolCalls(content.text, 'text', toolNames, toolSchemas, recoveryState);
              rescuedCalls.push(...processed.toolCalls);
              keepRemainder(processed.remainingText, content);
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
        preserveModelError(params, error);
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
                      // Every text-authored call is authoritative, including identical repeats.
                      emitToolCallChunks(processed.toolCalls, controller);
                      toolCallsFound = true;
                    }
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
        preserveModelError(params, error);
        throw error;
      }
    }
  };
}
