/**
 * @module utils/models/tool-rescue/generate
 *
 * The non-streaming outbound half: rescue tool calls out of a finished response's text parts.
 *
 * Sees the whole response at once, so it can resolve last-attempt-wins directly and reconcile the
 * carrier against the authoritative text counts in a single pass. Its streaming counterpart in
 * `./stream.ts` reaches the same answers incrementally; the rules both obey live in `./recovery.ts`.
 */

import type { LanguageModelV4CallOptions, LanguageModelV4ToolCall } from '@ai-sdk/provider';
import { createLogger } from '../../logger.js';
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

const logger = createLogger("tool-rescue");

/** Rescue tool calls out of one completed generation, in place. */
export function rescueGenerateResult(result: any, params: LanguageModelV4CallOptions): any {
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
  result.content = result.content.map((content: any) =>
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
    (content: any) => content.type === "tool-call" && toolNames.has(content.toolName)
  );
  if (!hasGameToolCall && params.tools && params.tools.length > 0) {
    const newContents: typeof result.content = [];
    const rescuedCalls: LanguageModelV4ToolCall[] = [];
    const recoveryState = createToolCallRecoveryState();
    const carrierParts: LanguageModelV4ToolCall[] = [];

    // Structured mode: pre-rescue every text part and mark the last call-yielding one as the
    // winner, so the loop commits only its calls. undefined entries are non-text content.
    const structuredTextRescues = structuredActive
      ? result.content.map((content: any) =>
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
}
