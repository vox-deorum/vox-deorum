/**
 * @module utils/models/tool-rescue/recovery
 *
 * The rescue mechanics both halves of the middleware share: turning one text payload into tool
 * calls with the same parsing rules.
 *
 * `wrapGenerate` and `wrapStream` see very different shapes, a finished content array versus a
 * chunk stream, but must agree exactly on which calls a payload contains. Everything they have to
 * agree on lives here, so the two transports cannot drift.
 */

import { rescueToolCallsFromText } from './extract.js';
import { normalizeKeysToSchema, type JsonSchemaNode } from '../../tools/normalize-keys.js';

/**
 * Rescues calls from one text payload. Text is authoritative: every call the payload contains
 * survives, including identical calls split across separate text blocks. The remainingText
 * contract is passed through unchanged from rescueToolCallsFromText.
 */
export function recoverToolCalls(
  payload: string,
  availableTools: Set<string>,
  toolSchemas: Map<string, JsonSchemaNode>,
  useJaison: boolean = true
): ReturnType<typeof rescueToolCallsFromText> {
  return rescueToolCallsFromText(payload, availableTools, useJaison, toolSchemas);
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
