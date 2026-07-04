/**
 * @module utils/models/tool-rescue/prompt
 *
 * Prompt-shaping helpers used when a model lacks native tool calling.
 * Generates the system prompt that teaches the model the JSON tool-call
 * format, and rewrites prior tool-call/tool-result message parts to plain
 * text so the conversation history matches what the model actually produces.
 */

import {
  JSONSchema7,
  LanguageModelV3FunctionTool,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3ProviderTool,
  LanguageModelV3ToolChoice,
} from '@ai-sdk/provider';
import { formatToolCallText, formatToolResultOutput } from '../text-cleaning.js';
import type { ToolCallFraming } from './types.js';

/**
 * Terminology presets for the tool-call instructions. `noun` doubles as the JSON
 * name field (`{ "<noun>": "<noun>_name", ... }`), keeping the instructed key in
 * lockstep with `formatToolCallText`. `listKey` is the pluralized wrapper key used by
 * {@link buildToolCallArraySchema}, defined here so the pluralization convention lives in
 * one place. `'tool'` reproduces the historical strings byte-for-byte, which the ~15
 * prompt-mode models depend on.
 */
const FRAMING_PRESETS = {
  tool:   { heading: '## Tool Calling',   listHeading: '## Available Tools',   noun: 'tool',   listKey: 'tools'   },
  action: { heading: '## Action Calling', listHeading: '## Available Actions', noun: 'action', listKey: 'actions' },
} as const;

/**
 * The tools we emulate via prompt/JSON. Provider tools belong to the host CLI (e.g. claude-code's
 * `Read`) and are never taught or constrained here; centralizing the filter keeps the instruction
 * prompt and {@link buildToolCallArraySchema} from ever disagreeing about which tools are in play.
 */
function functionTools(
  tools: (LanguageModelV3FunctionTool | LanguageModelV3ProviderTool)[]
): LanguageModelV3FunctionTool[] {
  return tools.filter((tool): tool is LanguageModelV3FunctionTool => tool.type !== 'provider');
}

/**
 * Case-preserving, whole-word rewrite of "tool" wording to "action" wording.
 * Used to reframe human-authored system-prompt prose ("the `send-message` tool",
 * "Available Tools") to match the `'action'` framing the model is instructed to use.
 *
 * Deliberately confined to prose: the injected JSON protocol and the tool-call wire
 * format are reframed by construction via {@link FRAMING_PRESETS}, never by this
 * regex, so tool argument schemas can never be corrupted. Whole-word `\b` boundaries
 * leave `toolkit`, `stool`, and backticked tool names (`send-message`) untouched.
 */
export function reframeToolWording(text: string): string {
  return text.replace(/\b(TOOLS|TOOL|Tools|Tool|tools|tool)\b/g, (match) => {
    switch (match) {
      case 'TOOLS': return 'ACTIONS';
      case 'TOOL':  return 'ACTION';
      case 'Tools': return 'Actions';
      case 'Tool':  return 'Action';
      case 'tools': return 'actions';
      default:      return 'action';
    }
  });
}

export function createToolPrompt(tool: (LanguageModelV3FunctionTool | LanguageModelV3ProviderTool)) {
  // We don't support provider tools this way
  if (tool.type === "provider") return;
  let toolInfo = `### ${tool.name}`;
  if (tool.description) {
    toolInfo += `\n- Description: ${tool.description}`;
  }
  if (tool.inputSchema) {
    toolInfo += `\n- Arguments: \n\`\`\`\n${JSON.stringify(tool.inputSchema, null, 2)}\n\`\`\``;
  }
  return toolInfo;
}

/**
 * Creates a tool instruction prompt for models that don't support native tool calling
 * @param tools Array of tool definitions with names and schemas
 * @returns System prompt text instructing the model to use JSON format for tool calls
 */
export function createToolPrompts(tools: (LanguageModelV3FunctionTool | LanguageModelV3ProviderTool)[],
  choice: LanguageModelV3ToolChoice,
  framing: ToolCallFraming = 'tool'): string | undefined {
  // Format tools with their schemas (provider tools are excluded via functionTools)
  const descriptions = functionTools(tools).map(createToolPrompt).join('\n\n');
  const { heading, listHeading, noun } = FRAMING_PRESETS[framing];

  // Format the prompt
  switch (choice.type) {
    case "required":
      return `${heading}
You must use one or more ${noun}s from the list below. Respond ONLY with a JSON array in this exact format:
\`\`\`json
[
  { "${noun}": "<${noun}_name>", "arguments": { <parameters> } },
]
\`\`\`

${listHeading}
${descriptions}`;
    case "tool":
      return `${heading}
You must use the ${noun} defined below. Respond ONLY with a JSON object in this exact format:
{ "${noun}": "<${noun}_name>", "arguments": { <parameters> } }

${descriptions}`;
    case "none":
      return undefined;

    default:
      return `${heading}
You have access to ${noun}s. If you decide to invoke any of the ${noun}(s), ONLY respond with a JSON array in this EXACT format as the text output:
\`\`\`json
[
  { "${noun}": "<${noun}_name>", "arguments": { <parameters> } },
]
\`\`\`

${listHeading}
${descriptions}`;
  }
}

/**
 * Builds a shape-only JSON Schema used as the `responseFormat.schema` so a
 * constrained-decoding provider (claude-code) is forced to emit the tool-call array in our
 * contour. The **root is an object** wrapping the array under `"<noun>s"`: a constrained-
 * decoding provider realizes `responseFormat` as a forced tool call, and the Anthropic API
 * rejects any tool whose `input_schema.type` is not `'object'` (400
 * `tools.0.custom.input_schema.type`), so an array root is illegal. The rescue unwraps the
 * array property (keyed `listKey`), keeping the wrapper transparent downstream, so the injected
 * prompt can keep teaching the shared bare-array contour. The item `noun` key and the `listKey`
 * both come from {@link FRAMING_PRESETS} (and therefore stay in lockstep with `formatToolCallText`),
 * and provider tools are excluded via the shared {@link functionTools} filter. Only the array and
 * the action name (an enum of the active tool names) are constrained; `arguments` stays an open
 * object, so per-argument validity remains with each tool's `execute`. If the CLI cannot enforce
 * the open object it silently falls back to prose, which the existing rescue still parses, so this
 * is never worse than prompt-only mode.
 */
export function buildToolCallArraySchema(
  tools: (LanguageModelV3FunctionTool | LanguageModelV3ProviderTool)[],
  framing: ToolCallFraming = 'tool'
): JSONSchema7 {
  const { noun, listKey } = FRAMING_PRESETS[framing];
  const names = functionTools(tools).map(tool => tool.name);
  return {
    type: 'object',
    properties: {
      [listKey]: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            [noun]: { type: 'string', enum: names },
            arguments: { type: 'object' },
          },
          required: [noun, 'arguments'],
          additionalProperties: false,
        },
        minItems: 1
      },
    },
    required: [listKey],
    additionalProperties: false,
  };
}

/**
 * Converts tool-call and tool-result messages in a prompt to text-based equivalents.
 * Used in prompt mode so the model sees a consistent text-based conversation history
 * instead of native tool-call/tool-result parts it never produced.
 */
export function convertPromptToolMessagesToText(prompt: LanguageModelV3Prompt, framing: ToolCallFraming = 'tool'): LanguageModelV3Prompt {
  const converted: LanguageModelV3Message[] = [];

  for (const message of prompt) {
    if (message.role === 'assistant') {
      // Convert tool-call/tool-result parts to text in a single pass
      const newContent: typeof message.content = [];
      for (const part of message.content) {
        // Provider-executed parts belong to the host CLI's own tools (e.g. claude-code's
        // Read), not the prompt-emulated game tools. Leave them native so the provider
        // serializes them itself; reframing them as game "actions" would misattribute
        // built-in tool use to the game and corrupt the history the model sees next turn.
        // In assistant content a tool-result part exists only for a provider-executed
        // tool (client results arrive as a separate `tool` role message, handled below),
        // so it is left native as well.
        if (part.type === 'tool-result') {
          newContent.push(part);
          continue;
        }
        if (part.type === 'tool-call') {
          if (part.providerExecuted) {
            newContent.push(part);
            continue;
          }
          let args = part.input;
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { /* keep as-is */ }
          }
          newContent.push({ type: 'text', text: formatToolCallText(part.toolName, args, framing) });
          continue;
        }
        newContent.push(part);
      }

      converted.push({ ...message, content: newContent });

    } else if (message.role === 'tool') {
      // Convert tool message to user message with text content
      const textParts = message.content
        .filter(part => part.type === 'tool-result')
        .map(part => formatToolResultOutput(part, -1, framing))
        .filter((text): text is string => text !== undefined)
        .map(text => ({ type: 'text' as const, text }));

      // Merge into previous user message if one exists, to avoid consecutive user messages
      const prev = converted[converted.length - 1];
      if (prev && prev.role === 'user') {
        prev.content = [...prev.content, ...textParts];
      } else {
        converted.push({ role: 'user', content: textParts });
      }

    } else {
      converted.push(message);
    }
  }

  return converted;
}
