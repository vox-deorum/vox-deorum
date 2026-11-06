/**
 * @module utils/models/tool-rescue/generate
 *
 * The non-streaming outbound half: rescue tool calls out of a finished response's text parts.
 *
 * Sees the whole response at once, so it can take every text part in a single pass. Its streaming
 * counterpart in `./stream.ts` reaches the same answers incrementally; the rules both obey live in
 * `./recovery.ts`.
 */

import type { LanguageModelV4CallOptions, LanguageModelV4ToolCall } from '@ai-sdk/provider';
import {
  buildToolSchemaMap,
  normalizeToolCallPartKeys,
  recoverToolCalls,
} from './recovery.js';

/** Rescue tool calls out of one completed generation, in place. */
export function rescueGenerateResult(result: any, params: LanguageModelV4CallOptions): any {
  params.tools = params.tools ?? (params as any).originalTools;

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

  // Rescue tool calls from JSON text if we have tools but no *game* tool call yet. A native
  // provider tool call is not a game call, so the text is still inspected; only a genuine game
  // tool call means there is nothing to rescue.
  const hasGameToolCall = result.content.some(
    (content: any) => content.type === "tool-call" && toolNames.has(content.toolName)
  );
  if (!hasGameToolCall && params.tools && params.tools.length > 0) {
    const newContents: typeof result.content = [];
    const rescuedCalls: LanguageModelV4ToolCall[] = [];

    // Honor rescueToolCallsFromText's remainingText contract for a text part: byte-identical
    // means untouched prose (keep the original part), a shorter string means a call/husk was
    // consumed (push the remainder), and undefined means nothing meaningful is left (drop it).
    const keepRemainder = (remainingText: string | undefined, original: { text: string }) => {
      if (remainingText === original.text) newContents.push(original as any);
      else if (remainingText) newContents.push({ type: 'text', text: remainingText });
    };

    for (const content of result.content) {
      if (content.type === "text") {
        const processed = recoverToolCalls(content.text, toolNames, toolSchemas);
        rescuedCalls.push(...processed.toolCalls);
        keepRemainder(processed.remainingText, content);
        continue;
      }
      newContents.push(content);
    }

    if (rescuedCalls.length > 0) {
      newContents.push(...rescuedCalls);
      result.finishReason = { unified: 'tool-calls', raw: result.finishReason?.raw };
    }

    // Update result with new contents
    result.content = newContents;
  }

  return result;
}
