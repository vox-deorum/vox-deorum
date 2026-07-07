/**
 * @module utils/models/text-cleaning
 *
 * Text cleaning and formatting utilities for tool call/result text representations.
 */

import { jsonToMarkdown } from '../tools/json-to-markdown.js';
import type { ToolCallFraming } from './tool-rescue/types.js';

/** Minimal interface for tool result parts accepted by formatting functions. */
interface ToolResultLike {
  toolName: string;
  output: { type: string; value?: unknown };
}

/**
 * Strips a leading `[Turn N]` marker — and, when the speaker's own label is known, the exact
 * `{selfLabel}:` echo right after it — from a spoken line. The envoy prefixes its context rows
 * with `[Turn N] {civ}, the {role}: `, so models sometimes echo that scaffolding back into their
 * replies. ONLY the exact label is stripped (never a generic `word:` pattern), so legitimate
 * openings like "Chairman: we accept" — or another civ's label — survive untouched. Called with no
 * `selfLabel` it strips just the turn marker (superseding the former `stripTurnMarker`).
 */
export function stripSpokenEcho(text: string, selfLabel?: string): string {
  const marker = text.match(/^\[Turn \d+\]\s*/);
  if (!marker) return text;
  let rest = text.slice(marker[0].length);
  if (selfLabel && rest.startsWith(`${selfLabel}:`)) {
    rest = rest.slice(selfLabel.length + 1).replace(/^[ \t]+/, '');
  }
  return rest;
}

/**
 * Strips structural artifacts left behind by tool call extraction from LLM text.
 * Removes empty JSON arrays, empty markdown code blocks, and standalone fence markers.
 */
export function cleanToolArtifacts(text: string): string {
  return text
    // Remove complete delimiter-based tool calls block: <|tool_calls_section_begin|> ... <|tool_calls_section_end|>
    .replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g, '')
    // Truncate incomplete tool calls block (beginning marker arrived but no end marker yet)
    .replace(/<\|tool_calls_section_begin\|>[\s\S]*$/, '')
    // Remove complete delimiter-based tool call blocks: <|tool_call_begin|> ... <|tool_call_end|>
    .replace(/<\|tool_call_begin\|>[\s\S]*?<\|tool_call_end\|>/g, '')
    // Truncate incomplete tool call blocks (beginning marker arrived but no end marker yet)
    .replace(/<\|tool_call_begin\|>[\s\S]*$/, '')
    // Remove complete bracket-based tool call blocks: [TOOL_CALL] ... [/TOOL_CALL]
    .replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/g, '')
    // Truncate incomplete bracket-based tool call blocks (opening tag arrived but no closing tag yet)
    .replace(/\[TOOL_CALL\][\s\S]*$/, '')
    // Remove any leftover individual markers
    .replace(/<\|tool_call(?:_argument)?_(?:begin|end)\|>/g, '')
    // Remove standalone section markers: <|tool_calls_section_begin|>, <|tool_calls_section_end|>
    .replace(/<\|tool_calls_section_(?:begin|end)\|>/g, '')
    // Remove standalone section markers: <|tool_call_begin|>, <|tool_call_end|>
    .replace(/<\|tool_call_(?:begin|end)\|>/g, '')
    // Remove standalone bracket-based markers: [TOOL_CALL], [/TOOL_CALL]
    .replace(/\[\/?TOOL_CALL\]/g, '')
    // Remove empty/comma-only JSON arrays: [], [,], [ , , ], etc.
    .replace(/\[\s*(?:,\s*)*\]/g, '')
    // Truncate incomplete empty/comma-only JSON arrays (beginning marker arrived but no end marker yet)
    .replace(/\[\s*(?:,\s*)*$/g, '')
    // Remove empty markdown code blocks: ```json\n\n```, ```\n```
    .replace(/\`\`\`(?:json)?\s*\`\`\`/g, '')
    // Remove standalone fence markers on their own line
    .replace(/^\s*\`\`\`(?:json)?\s*$/gm, '')
    // Remove minimax tool_call artifact
    .replace(/^minimax:tool_call$/gm, '')
    .trim();
}

/**
 * Builds one tool-call object in the framing-keyed wire shape (`{ "<framing>": name, arguments }`),
 * parsing a JSON-string argument into structured args and leaving anything unparseable as-is.
 * Shared by the bare-array and wrapper-object emitters so both parse arguments identically.
 */
function toToolCallObject(toolName: string, args: unknown, framing: ToolCallFraming) {
  let parsed = args;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { /* keep as-is */ }
  }
  return { [framing]: toolName, arguments: parsed };
}

/**
 * Formats a tool call as a markdown JSON code block (prompt-mode representation).
 * `framing` selects the JSON name field: the framing literal IS the key, so
 * `'tool'` emits `{ "tool": ... }` and `'action'` emits `{ "action": ... }`,
 * matching the wire format that `createToolPrompts` instructs the model to use.
 */
export function formatToolCallText(toolName: string, args: unknown, framing: ToolCallFraming = 'tool'): string {
  return '```json\n' + JSON.stringify([toToolCallObject(toolName, args, framing)], null, 2) + '\n```';
}

/**
 * Formats one or more tool calls as a single wrapper-object JSON code block
 * (`{ "<wrapKey>": [ { "<framing>": name, arguments }, ... ] }`). Used in prompt mode when
 * constrained decoding forces the wrapper object, so the echoed history matches the wrapper-object
 * shape `createToolPrompts(..., wrapped = true)` teaches instead of the bare-array `formatToolCallText`.
 * `wrapKey` (the `listKey` from FRAMING_PRESETS: `actions`/`tools`) is passed in rather than derived
 * here to keep this module free of a back-import from `prompt.ts` (which imports from this one).
 */
export function formatWrappedToolCallText(
  calls: Array<{ toolName: string; args: unknown }>,
  framing: ToolCallFraming,
  wrapKey: string,
): string {
  const objs = calls.map(call => toToolCallObject(call.toolName, call.args, framing));
  return '```json\n' + JSON.stringify({ [wrapKey]: objs }, null, 2) + '\n```';
}

/**
 * Formats a tool result with a markdown heading and content.
 */
export function formatToolResultText(toolName: string, resultText: string, framing: ToolCallFraming = 'tool'): string {
  return `# ${framing === 'action' ? 'Action' : 'Tool'} ${toolName} Result\n${resultText}`;
}

/**
 * Serializes a tool result part's output into readable text.
 */
export function formatToolResultOutput(part: ToolResultLike, maxLength: number = -1, framing: ToolCallFraming = 'tool'): string | undefined {
  const output = part.output;
  const value = output.value;
  let resultText: string;

  switch (output.type) {
    case 'text':
      resultText = String(value);
      break;
    case 'json':
      if (typeof value === "string")
        resultText = value;
      else resultText = jsonToMarkdown(value);
      break;
    case 'error-text':
      resultText = `Error: ${value}`;
      if (maxLength !== -1) resultText = "[Error]";
      break;
    case 'error-json':
      resultText = `Error: ${jsonToMarkdown(value)}`;
      if (maxLength !== -1) resultText = "[Error]";
      break;
    case 'content':
      return undefined;
    default:
      resultText = JSON.stringify(output);
  }

  let text = formatToolResultText(part.toolName, resultText, framing);
  if (maxLength !== -1 && text.length > maxLength) {
    text = text.slice(0, maxLength) + ' [Truncated]';
  }
  return text;
}

/**
 * Builds a recovery prompt for empty response rescue.
 * The prompt varies based on the effective toolChoice to guide the model appropriately.
 * `framing` keeps the terminology ("tool" vs "action") consistent with the injected
 * instructions so the retry does not point a claude-code model at its built-in tools.
 * Defaults to `'tool'`, which reproduces the historical wording byte-for-byte.
 */
export function buildRescuePrompt(toolChoice: string, framing: ToolCallFraming = 'tool'): string {
  const noun = framing === 'action' ? 'action' : 'tool';
  if (toolChoice === "required" || toolChoice === "tool") {
    return `Your previous response was empty and did not include any ${noun} calls. You MUST call one or more of the available ${noun}s in the given format. Please try again.`;
  }
  return `Your previous response was empty. Please provide either a text response or PROPERLY call one or more of the available ${noun}s in the given format.`;
}
