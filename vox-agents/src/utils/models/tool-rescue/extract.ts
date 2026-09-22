/**
 * @module utils/models/tool-rescue/extract
 *
 * Parses JSON tool calls embedded in free-form model text. Supports
 * markdown code blocks, raw JSON arrays/objects, and the
 * `<|tool_call_begin|>...<|tool_call_end|>` delimiter format. Returns
 * the rescued tool calls plus any leftover text that wasn't consumed.
 */

import type { LanguageModelV4ToolCall } from '@ai-sdk/provider';
// @ts-expect-error - jaison doesn't have type definitions
import jaison from 'jaison';
import { createLogger } from '../../logger.js';
import { normalizeKeysToSchema, type JsonSchemaNode } from '../../tools/normalize-keys.js';

const logger = createLogger("tool-rescue");

// Keys under which constrained-decoding providers wrap the tool-call array (the
// `listKey` values in buildToolCallArraySchema). A parsed object whose only keys
// are these is a bare wrapper shell (e.g. `{"actions":}` left behind after the
// real calls were extracted natively), not a failed tool call.
const WRAPPER_KEYS = new Set(['tools', 'actions']);

// The name/parameters key pairs a rescued tool call may be spelled with. Both 'tool' and
// 'action' keys are always accepted (framing-agnostic): the 'action' key is what the
// claude-code provider's prompt instructs; tool-name validation keeps this safe.
//
// Module scope rather than a local, so the full rescue below and the partial-buffer scan in
// findStreamableToolCallStart can never drift on which contours they recognize.
const FIELD_PATTERNS = [
  { nameField: 'name', parametersField: 'parameters' },
  { nameField: 'toolName', parametersField: 'input' },
  { nameField: 'tool', parametersField: 'arguments' },
  { nameField: 'action', parametersField: 'arguments' }
] as const;

// Recognized parameter-field keys, for stripping nullish husks in the flattened fallback.
const PARAMETER_FIELDS = new Set<string>(FIELD_PATTERNS.map(p => p.parametersField));

/**
 * Unwraps the extra function-arguments envelope some providers put around a structured tool
 * payload. Only a lone `arguments` string whose decoded value already has a recognized wrapper or
 * tool-call contour is accepted, so arbitrary string-encoded JSON remains ordinary text.
 */
function unwrapStringEncodedToolPayload(value: unknown, useJaison: boolean): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length !== 1 || entries[0][0] !== 'arguments' || typeof entries[0][1] !== 'string') {
    return value;
  }

  let nested: unknown;
  try {
    nested = useJaison ? jaison(entries[0][1]) : JSON.parse(entries[0][1]);
  } catch {
    return value;
  }

  if (Array.isArray(nested)) {
    const hasOnlyToolCallContours = nested.length > 0 && nested.every((item) =>
      item && typeof item === 'object' && !Array.isArray(item)
      && FIELD_PATTERNS.some(pattern => typeof item[pattern.nameField] === 'string'));
    return hasOnlyToolCallContours ? nested : value;
  }
  if (!nested || typeof nested !== 'object') return value;
  const nestedObject = nested as Record<string, unknown>;
  const hasWrapper = Object.entries(nestedObject)
    .some(([key, wrapped]) => WRAPPER_KEYS.has(key) && Array.isArray(wrapped));
  const isDirectCall = FIELD_PATTERNS.some(pattern => typeof nestedObject[pattern.nameField] === 'string');
  return hasWrapper || isDirectCall ? nested : value;
}

// Simple ID generator
function generateId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * True when a parsed value is a bare constrained-decoding wrapper husk: a non-array object whose
 * keys are all wrapper keys (`tools`/`actions`) AND whose every wrapper value is empty — an array
 * (the emptied `{"actions": []}`) or nullish (the `{"actions":}` husk jaison repairs to
 * `{actions: null}`). This is the empty envelope the provider leaves in text after diverting the
 * real calls to the tool-call channel. A wrapper key holding a truthy non-array value — e.g.
 * `{"actions": "I recommend a settler"}` — is NOT a husk but genuine model prose, and must be
 * preserved rather than silently stripped; the value check is what distinguishes the two.
 */
function isWrapperShell(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0
    && entries.every(([key, val]) => WRAPPER_KEYS.has(key) && (val == null || Array.isArray(val)));
}

/**
 * Removes an extracted JSON block from its surrounding text, returning the leftover prose (trimmed)
 * or undefined when nothing meaningful remains. Shared by the rescued-call path and the wrapper-shell
 * husk path so both consume their JSON identically instead of leaving it as free text.
 */
function removeExtractedBlock(text: string, extractedContent: string): string | undefined {
  if (!extractedContent || extractedContent === text) return undefined;
  const blockIndex = text.indexOf(extractedContent);
  // Defensive only: every caller derives extractedContent as a verbatim substring of text, so a
  // miss shouldn't happen — fall back to the trimmed whole rather than splice at a bogus index.
  if (blockIndex === -1) return text.trim() || undefined;
  const before = text.substring(0, blockIndex).trim();
  const after = text.substring(blockIndex + extractedContent.length).trim();
  return (before + ' ' + after).trim() || undefined;
}

/**
 * True when a native tool-call name is the claude-code constrained-decoding carrier
 * (`claude-code-tool.StructuredOutput`, or an `mcp__…__StructuredOutput` variant).
 *
 * When `responseFormat` is set, the Agent SDK realizes it by forcing an internal
 * `StructuredOutput` tool whose input is our `{ actions: [...] }` wrapper, and that tool
 * surfaces to the AI SDK as a native `tool-call` part rather than text. Matching by a loose
 * name substring (not by "not one of our game tools") keeps legitimate provider built-ins
 * (`Read`, other `mcp__…` tools) from being mistaken for the carrier. The literal name is
 * generated by the CLI binary, so a code constant is unavailable; the regex is intentionally
 * permissive about the prefix.
 */
export function isStructuredOutputToolName(name: string): boolean {
  return /structuredoutput/i.test(name);
}

/**
 * Resolves a model-emitted tool name to an actual available tool name. An exact match is
 * preferred so a tool whose real name contains underscores round-trips under constrained
 * decoding; otherwise the hyphenated form is tried, covering models that emit `send_message`
 * when the tool is named `send-message`. Returns undefined when neither form is available.
 */
function resolveToolName(candidate: string, availableTools: Set<string>): string | undefined {
  if (availableTools.has(candidate)) return candidate;
  const hyphenated = candidate.replaceAll(/_/g, '-');
  if (hyphenated !== candidate && availableTools.has(hyphenated)) return hyphenated;
  return undefined;
}

/** A streamable tool call located in a buffer that is still growing. */
export interface StreamableToolCallStart {
  /** The canonical available-tool name, as {@link resolveToolName} resolved it. */
  toolName: string;
  /** Index in the buffer of the `{` that opens this call's ARGUMENTS object. */
  argsStart: number;
  /**
   * How many calls resolving to this same tool name close before this one in the buffer.
   *
   * The scan reports the first call it can STREAM, which is not necessarily the first call of that
   * name the full rescue COMMITS: the flattened contour (see the fallback in
   * {@link rescueToolCallsFromText}) has no arguments object to anchor deltas on, so it is passed
   * over here yet still rescued. Without this ordinal a caller pairing the two halves by name alone
   * would hand the streamed arguments to an earlier, unstreamed call of the same name.
   *
   * Counted among siblings only — calls nested inside another call's arguments live at a different
   * depth and are not part of the array the rescue walks.
   */
  ordinal: number;
}

/**
 * The delimiter contour, up to and including its arguments brace. Only the leading form is
 * matched (not the closing `<|tool_call_end|>`), because the whole point is to recognize the
 * call while its arguments are still streaming.
 */
const STREAMABLE_DELIMITER =
  /<\|tool_call_begin\|>\s*(?:functions\.)?([^\s:]+)(?::\d+)?\s*<\|tool_call_argument_begin\|>\s*\{/;

/**
 * Reads the JSON string literal whose opening quote is at `start`.
 *
 * Returns undefined when the literal is not yet fully buffered, which is what lets the caller
 * distinguish "wait for more text" from "this is not a string". Escapes are consumed rather than
 * decoded — the returned `value` is only ever compared against key and tool names, and `end` stays
 * exact regardless, since the only escape that can hide a terminator is `\"`.
 */
function readJsonStringLiteral(buffer: string, start: number): { value: string, end: number } | undefined {
  let value = '';
  let i = start + 1;
  while (i < buffer.length) {
    const char = buffer[i];
    if (char === '"') return { value, end: i + 1 };
    if (char === '\\') {
      if (i + 1 >= buffer.length) return undefined;
      value += buffer[i + 1];
      i += 2;
      continue;
    }
    value += char;
    i++;
  }
  return undefined;
}

/** JSON insignificant whitespace. */
function isJsonWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

/**
 * Locates the first *streamable* tool call in a PARTIAL (still-growing) buffer, so a caller can
 * begin forwarding that call's arguments before the JSON is complete.
 *
 * This is the streaming counterpart of {@link rescueToolCallsFromText} and shares its
 * {@link FIELD_PATTERNS}, so the two can never disagree about which contours are a tool call. It
 * answers a deliberately narrow question — "which tool, and where do its arguments begin" — and
 * leaves parsing to the full rescue once the text is complete.
 *
 * Returns undefined whenever the buffer does not YET determine a streamable call. Callers re-run
 * this on every growth step, so "not yet" and "never" are intentionally not distinguished.
 *
 * The scan is a string-aware walk rather than a substring search, because the text being scanned is
 * unvalidated model output: a tool name quoted inside some other argument's value must not start a
 * stream. Only a token that is actually a KEY, in an object frame, paired with the parameters key
 * its own pattern names, can resolve a call.
 *
 * @param buffer Text from the JSON start marker onward, growing across calls
 * @param availableTools Tool names this request actually offers
 * @param streamableTools The closed set of tools whose partial arguments a caller can consume
 */
export function findStreamableToolCallStart(
  buffer: string,
  availableTools: Set<string>,
  streamableTools: ReadonlySet<string>
): StreamableToolCallStart | undefined {
  // The delimiter contour is its own grammar, not JSON, so it is recognized up front — the walk
  // below would read `<|tool_call_begin|> functions.send-message ...` as unquoted prose.
  if (buffer.includes('<|tool_call_begin|>')) {
    const match = STREAMABLE_DELIMITER.exec(buffer);
    if (!match) return undefined;
    const resolved = resolveToolName(match[1].trim(), availableTools);
    if (!resolved || !streamableTools.has(resolved)) return undefined;
    // Only the FIRST delimiter block can ever match this regex, and the rescue walks the same
    // blocks left to right, so a delimiter hit never has a same-named call ahead of it.
    return { toolName: resolved, argsStart: match.index + match[0].length - 1, ordinal: 0 };
  }

  /** One in-progress object: what its name and parameters keys have declared so far. */
  interface ObjectFrame {
    name?: string;
    namePattern?: (typeof FIELD_PATTERNS)[number];
    argsField?: string;
    argsStart?: number;
  }

  /**
   * Calls already closed in the buffer, by the tool they resolve to and the object depth they sit
   * at. Recorded whatever contour they were spelled with — nested or flattened — because the point
   * is to count what the full rescue will COMMIT ahead of the streamed call, not what could have
   * been streamed. A name that resolves to no available tool is skipped for the same reason: the
   * rescue skips it too.
   */
  const closed: Array<{ depth: number, toolName: string }> = [];

  /**
   * Whether this frame now names a streamable call. A name paired with a parameters key that its
   * own pattern does not name (say `name` with `arguments`) is rejected: the full rescue would
   * fall through to its flattened fallback and build a malformed call, so streaming it would speak
   * text that never becomes a real tool call. A later, correctly-paired key simply overwrites.
   */
  const resolveFrame = (frame: ObjectFrame): StreamableToolCallStart | undefined => {
    if (frame.name === undefined || frame.argsStart === undefined) return undefined;
    if (frame.namePattern!.parametersField !== frame.argsField) return undefined;
    const resolved = resolveToolName(frame.name, availableTools);
    if (!resolved || !streamableTools.has(resolved)) return undefined;
    // Both call sites resolve the innermost open object, so this frame's own depth is the top index.
    const depth = stack.length - 1;
    const ordinal = closed.filter(prior => prior.depth === depth && prior.toolName === resolved).length;
    return { toolName: resolved, argsStart: frame.argsStart, ordinal };
  };

  const stack: ObjectFrame[] = [];
  let i = 0;
  while (i < buffer.length) {
    const char = buffer[i];
    // Everything that is not a brace or a quote — brackets, commas, fence backticks, stray prose —
    // only advances the cursor. A string body is never walked; it is consumed whole below.
    if (char === '{') { stack.push({}); i++; continue; }
    if (char === '}') {
      const frame = stack.pop();
      // After the pop, the stack length IS the closed frame's own depth.
      const priorName = frame?.name === undefined ? undefined : resolveToolName(frame.name, availableTools);
      if (priorName) closed.push({ depth: stack.length, toolName: priorName });
      i++;
      continue;
    }
    if (char !== '"') { i++; continue; }

    const token = readJsonStringLiteral(buffer, i);
    if (!token) return undefined;
    i = token.end;

    // A token is a key only when a colon follows it; otherwise it was a value and is now skipped.
    let next = i;
    while (next < buffer.length && isJsonWhitespace(buffer[next])) next++;
    if (next >= buffer.length) return undefined;
    if (buffer[next] !== ':') continue;
    next++;
    while (next < buffer.length && isJsonWhitespace(buffer[next])) next++;
    if (next >= buffer.length) return undefined;

    const frame = stack[stack.length - 1];
    if (!frame) { i = next; continue; }

    const namePattern = FIELD_PATTERNS.find(pattern => pattern.nameField === token.value);
    if (namePattern && buffer[next] === '"') {
      const name = readJsonStringLiteral(buffer, next);
      if (!name) return undefined;
      frame.name = name.value;
      frame.namePattern = namePattern;
      i = name.end;
      const hit = resolveFrame(frame);
      if (hit) return hit;
      continue;
    }

    if (PARAMETER_FIELDS.has(token.value) && buffer[next] === '{') {
      frame.argsField = token.value;
      frame.argsStart = next;
      const hit = resolveFrame(frame);
      if (hit) return hit;
      // Resume AT the brace, so the arguments object pushes its own frame and its keys can never
      // be read as this call's tool fields.
      i = next;
      continue;
    }

    i = next;
  }

  return undefined;
}

/**
 * Rescues tool calls from JSON text and transforms them into proper tool call format.
 * This function processes text that may contain JSON tool calls and converts them
 * to the format expected by the AI SDK.
 *
 * @param text The text to process
 * @param availableTools Set of available tool names for validation
 * @returns Rescued tool calls plus `remainingText`. Contract: `remainingText === text`
 *   (byte-identical) means nothing was consumed — the caller should pass the original
 *   text through untouched. Any other value (a shorter string, or `undefined`) means a
 *   tool call or an empty wrapper husk (`{"actions":}`) was consumed out of the text, and
 *   the caller should replace the original with `remainingText` (dropping it when `undefined`).
 */
export function rescueToolCallsFromText(
  text: string,
  availableTools: Set<string>,
  useJaison: boolean = true,
  toolSchemas?: Map<string, JsonSchemaNode>
): { remainingText?: string, toolCalls: LanguageModelV4ToolCall[] } {
  // Check for delimiter-based tool call format: <|tool_call_begin|> functions.name:N <|tool_call_argument_begin|> {...} <|tool_call_end|>
  const delimiterRegex = /<\|tool_call_begin\|>\s*(?:functions\.)?(.+?)(?::(\d+))?\s*<\|tool_call_argument_begin\|>\s*([\s\S]*?)\s*<\|tool_call_end\|>/g;
  let delimiterMatch;
  const delimiterToolCalls: LanguageModelV4ToolCall[] = [];
  let remainingAfterDelimiters = text;

  while ((delimiterMatch = delimiterRegex.exec(text)) !== null) {
    const rawToolName = delimiterMatch[1].trim();
    const argsText = delimiterMatch[3].trim();

    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = jaison(argsText);
    } catch {
      if (useJaison) logger.log("warn", `Failed to parse delimiter tool call arguments for ${rawToolName}: ${argsText}`);
      continue;
    }

    const toolName = resolveToolName(rawToolName, availableTools);
    if (!toolName) {
      if (useJaison) logger.log("warn", `Failed to rescue delimiter tool call: non-existent or unavailable tool ${rawToolName}`, parsedArgs);
      continue;
    }

    logger.log("debug", `Rescued delimiter tool call: ${toolName}`, parsedArgs);
    delimiterToolCalls.push({
      type: 'tool-call',
      toolCallId: generateId(),
      toolName,
      input: JSON.stringify(normalizeKeysToSchema(parsedArgs, toolSchemas?.get(toolName))),
    });
  }

  if (delimiterToolCalls.length > 0) {
    // Remove matched delimiter blocks and orphaned section markers from text
    remainingAfterDelimiters = text.replace(delimiterRegex, '')
      .trim() || undefined!;
    return { toolCalls: delimiterToolCalls, remainingText: remainingAfterDelimiters || undefined };
  }

  // First, try to extract the largest JSON block by finding balanced brackets/braces
  // This uses character-by-character parsing instead of regex
  function findJsonBlocks(str: string): string[] {
    const blocks: string[] = [];
    const openChars = ['{', '['];

    for (let i = 0; i < str.length; i++) {
      if (!openChars.includes(str[i])) continue;

      const startChar = str[i];
      const endChar = startChar === '{' ? '}' : ']';
      let depth = 1;
      let j = i + 1;
      let inString = false;
      let escapeNext = false;

      while (j < str.length && depth > 0) {
        const char = str[j];

        if (escapeNext) {
          escapeNext = false;
          j++;
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          j++;
          continue;
        }

        if (char === '"') {
          inString = !inString;
        } else if (!inString) {
          if (char === startChar) {
            depth++;
          } else if (char === endChar) {
            depth--;
          }
        }

        j++;
      }

      if (depth === 0) {
        blocks.push(str.substring(i, j));
      }
    }

    return blocks;
  }

  // If in strict mode and the json block is incomplete, skip it
  if (!useJaison && text.indexOf("```json") !== -1) return { toolCalls: [], remainingText: text };

  // First check for markdown code blocks with ```json syntax
  const codeBlockRegex = /```json\s*\n([\s\S]*?)\n```/;
  const codeBlockMatch = text.match(codeBlockRegex);

  let jsonText: string;

  if (codeBlockMatch) {
    // If markdown code block found, use its content directly
    jsonText = codeBlockMatch[1].trim();
  } else {
    // Otherwise, find all potential JSON blocks and select the largest one
    const jsonBlocks = findJsonBlocks(text);
    let largestBlock = '';
    let largestBlockSize = 0;

    for (const block of jsonBlocks) {
      if (block.length > largestBlockSize) {
        largestBlock = block;
        largestBlockSize = block.length;
      }
    }

    // If no JSON block found, try to parse the entire text
    jsonText = largestBlock || text;
  }

  // Try to parse the JSON using jaison
  let parsed: any;
  try {
    if (useJaison)
      parsed = jaison(jsonText);
    else parsed = JSON.parse(jsonText);
  } catch {
    // Not valid JSON, return as text
    return { toolCalls: [], remainingText: text };
  }

  // StructuredOutput can serialize its generated object inside a lone `arguments` string. Decode
  // that extra layer only when the inner value already looks like a supported tool-call payload.
  parsed = unwrapStringEncodedToolPayload(parsed, useJaison);

  // A constrained-decoding provider returns the tool-call array wrapped in an object,
  // because its responseFormat root must be an object (see buildToolCallArraySchema). If the
  // parsed value is an object that is not itself a tool call but wraps the array, descend into
  // it. Prefer the known wrapper keys (`tools`/`actions`, from buildToolCallArraySchema);
  // otherwise only descend when exactly one property is an array, so an unrelated array-valued
  // sibling (e.g. a `metadata` list) cannot be mistaken for the tool-call list.
  let candidate: any = parsed;
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const looksLikeToolCall = FIELD_PATTERNS.some(pattern => candidate[pattern.nameField] !== undefined);
    if (!looksLikeToolCall) {
      const arrayEntries = Object.entries(candidate).filter(([, value]) => Array.isArray(value));
      const named = arrayEntries.find(([key]) => WRAPPER_KEYS.has(key));
      if (named) candidate = named[1];
      else if (arrayEntries.length === 1) candidate = arrayEntries[0][1];
    }
  }

  // Check if it's an array of tool calls
  const toolCalls = Array.isArray(candidate) ? candidate : [candidate];
  const rescuedToolCalls: LanguageModelV4ToolCall[] = [];
  // Set once any item looked like a real (but unrescuable) tool call — a wrong-shaped object or a
  // call naming an unavailable tool. That makes the block a genuine failed rescue worth surfacing,
  // NOT the empty wrapper husk, so it must never be silently stripped as one.
  let sawUnrescuableCall = false;

  for (const toolCall of toolCalls) {
    if (!toolCall) continue;

    // Try each field pattern to find valid tool call structure
    let toolName: string | undefined;
    let toolParameters: Record<string, unknown> | undefined;
    let patternFound = false;

    for (const pattern of FIELD_PATTERNS) {
      const candidateName = toolCall[pattern.nameField];
      const candidateParams = toolCall[pattern.parametersField];

      if (candidateName && candidateParams) {
        toolName = candidateName;
        toolParameters = candidateParams;
        patternFound = true;
        break;
      }
    }

    // Flattened fallback: some models (claude-code 'action' framing) hoist the arguments
    // to the top level, e.g. `{"action": "keep-status-quo", "Rationale": "..."}`. Accept it
    // only when exactly ONE recognized name field holds a string naming an available tool;
    // all remaining siblings become the arguments. Nested patterns above always win, and
    // an ambiguous object (two name fields) stays unrescuable rather than guessing.
    if (!patternFound && toolCall && typeof toolCall === 'object' && !Array.isArray(toolCall)) {
      const nameKeys = FIELD_PATTERNS
        .map(p => p.nameField)
        .filter(field => toolCall[field] && typeof toolCall[field] === 'string');
      if (nameKeys.length === 1) {
        const resolved = resolveToolName(toolCall[nameKeys[0]], availableTools);
        if (!resolved) {
          // A name-shaped field exists, so name the failure precisely rather than
          // emitting the generic "no matching field pattern" warning.
          sawUnrescuableCall = true;
          if (useJaison) logger.log("warn", `Failed to rescue tool call: non-existent or unavailable tool ${toolCall[nameKeys[0]]}`, toolCall);
          continue;
        }
        toolName = resolved;
        // Siblings are the arguments; a recognized params key holding null/undefined is a
        // husk of the nested shape (e.g. `{"action": "end-turn", "arguments": null}`), not an arg.
        toolParameters = Object.fromEntries(Object.entries(toolCall).filter(([key, value]) =>
          key !== nameKeys[0] && !(PARAMETER_FIELDS.has(key) && value == null)));
        patternFound = true;
      }
    }

    if (!patternFound) {
      // A bare wrapper husk (only wrapper keys, all empty) is a harmless remnant of the
      // constrained-decoding envelope, not a genuine parse failure. Anything else with keys
      // (including a wrapper key holding non-empty prose) is a real, unrescuable call.
      if (Object.keys(toolCall).length > 0 && !isWrapperShell(toolCall)) {
        sawUnrescuableCall = true;
        if (useJaison)
          logger.log("warn", `Failed to rescue tool call: no matching field pattern found from ${jsonText}`);
      }
      continue;
    }

    // Resolve to an available tool, tolerating underscore/hyphen differences in the emitted name.
    const resolvedName = resolveToolName(toolName!, availableTools);
    if (!resolvedName) {
      sawUnrescuableCall = true;
      if (useJaison) logger.log("warn", `Failed to rescue tool call: non-existent or unavailable tool ${toolName}`, toolParameters);
      continue;
    }
    toolName = resolvedName;

    logger.log("debug", `Rescued tool call: ${toolName}`, toolParameters!);

    // Transform into a tool call, aligning argument keys to the tool's schema casing.
    rescuedToolCalls.push({
      type: 'tool-call',
      toolCallId: generateId(),
      toolName: toolName!,
      input: JSON.stringify(normalizeKeysToSchema(toolParameters!, toolSchemas?.get(toolName!))),
    });
  }

  // Determine what was extracted - either the full markdown block or just the JSON content.
  const extractedContent = codeBlockMatch ? codeBlockMatch[0] : jsonText;

  // Return whatever rescued cleanly; entries that failed validation were skipped individually above.
  if (rescuedToolCalls.length > 0) {
    return { toolCalls: rescuedToolCalls, remainingText: removeExtractedBlock(text, extractedContent) };
  }

  // A bare constrained-decoding wrapper husk (`{"actions":}` / `{"actions": []}`) carries no tool
  // call and no salvageable prose, so consume it like a rescued call's JSON rather than leak it as
  // free text. A block that instead held a real-but-unrescuable call stays visible (fall through).
  if (!sawUnrescuableCall && isWrapperShell(parsed)) {
    return { toolCalls: [], remainingText: removeExtractedBlock(text, extractedContent) };
  }

  // If rescue failed, return original text
  return { toolCalls: [], remainingText: text };
}
