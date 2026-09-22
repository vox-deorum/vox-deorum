/**
 * @module utils/models/tool-rescue/recovery
 *
 * The rescue mechanics both halves of the middleware share: turning a payload into tool calls,
 * reconciling the two channels a constrained-decoding provider can deliver the same call on, and
 * deciding which of several competing attempts is the one to commit.
 *
 * `wrapGenerate` and `wrapStream` see very different shapes — a finished content array versus a
 * chunk stream — but must agree exactly on which call survives. Everything they have to agree on
 * lives here, so the two transports cannot drift.
 */

import type { LanguageModelV4ToolCall } from '@ai-sdk/provider';
import { rescueToolCallsFromText, isStructuredOutputToolName } from './extract.js';
import { normalizeKeysToSchema, type JsonSchemaNode } from '../../tools/normalize-keys.js';

/** A tool-call part's `input` is normally a JSON string, but guard against an object form. */
export function toolInputToString(input: unknown): string {
  return typeof input === 'string' ? input : JSON.stringify(input ?? {});
}

/** Comparison key for a rescued or native tool call: name plus its serialized input. */
function toolCallKey(toolCall: { toolName: string; input: unknown }): string {
  return `${toolCall.toolName}:${toolInputToString(toolCall.input)}`;
}

/** Identifies whether a rescued payload came from ordinary model text or the carrier channel. */
export type ToolCallSource = 'text' | 'carrier';

/** State shared by text and carrier recovery for one model response. */
export interface ToolCallRecoveryState {
  textCallCounts: Map<string, number>;
}

/** Creates empty source-aware recovery state for one model response. */
export function createToolCallRecoveryState(): ToolCallRecoveryState {
  return { textCallCounts: new Map() };
}

/**
 * Records text-sourced tool calls into the recovery state's multiplicity map, so a later carrier
 * reconciliation subtracts exactly the copies text already accounted for. Split out of
 * recoverToolCalls so the structured-mode finish path can register only the winning attempt's
 * calls (see the last-attempt-wins handling in wrapStream/wrapGenerate).
 */
export function recordTextToolCalls(
  toolCalls: readonly LanguageModelV4ToolCall[],
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
export type StructuredAttemptDisposition = 'winner' | 'superseded' | 'prose';

/**
 * Index of the winning attempt: the LAST rescue that yields any call (the CLI accepts the final
 * retry), or -1 when nothing validated. Accepts a sparse array so wrapGenerate can pass rescues
 * aligned to `result.content` with `undefined` for its non-text parts.
 */
export function lastAttemptWinnerIdx(
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
export function classifyStructuredAttempt(
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
export function recoverToolCalls(
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
export function isCarrierToolName(name: string, toolNames: Set<string>, active: boolean | undefined): boolean {
  return !!active && !toolNames.has(name) && isStructuredOutputToolName(name);
}

/**
 * Maps each function tool's canonical name to its full JSON Schema, so both the rescue path and the
 * native pass can realign the model's argument-key casing to the declared casing at every nesting
 * level (e.g. `message` → `Message`, or `Give:[{term}]` → `Give:[{Term}]`).
 */
export function buildToolSchemaMap(tools: readonly any[] | undefined): Map<string, JsonSchemaNode> {
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
export function normalizeToolCallPartKeys<T extends { input?: unknown }>(
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
