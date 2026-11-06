/**
 * @module utils/models/tool-rescue/prompt
 *
 * Prompt-shaping helpers used when a model lacks native tool calling.
 * Generates the system prompt that teaches the model the JSON tool-call
 * format, and rewrites prior tool-call/tool-result message parts to plain
 * text so the conversation history matches what the model actually produces.
 */

import {
  LanguageModelV4FunctionTool,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4ProviderTool,
  LanguageModelV4ToolChoice,
} from '@ai-sdk/provider';
import { formatToolCallText, formatToolResultOutput } from '../text-cleaning.js';
import type { ToolCallFraming } from './types.js';

/**
 * Terminology presets for the tool-call instructions. `noun` doubles as the JSON
 * name field (`{ "<noun>": "<noun>_name", ... }`), keeping the instructed key in
 * lockstep with `formatToolCallText`. `'tool'` reproduces the historical strings
 * byte-for-byte, which the ~15 prompt-mode models depend on.
 */
const FRAMING_PRESETS = {
  tool:   { heading: '## Tool Calling',   listHeading: '## Available Tools',   noun: 'tool'   },
  action: { heading: '## Action Calling', listHeading: '## Available Actions', noun: 'action' },
} as const;

/**
 * The tools we emulate via prompt/JSON. Provider tools belong to the host CLI and are never
 * taught here; centralizing the filter keeps the instruction prompt from ever offering a tool
 * the rescue cannot parse.
 */
function functionTools(
  tools: (LanguageModelV4FunctionTool | LanguageModelV4ProviderTool)[]
): LanguageModelV4FunctionTool[] {
  return tools.filter((tool): tool is LanguageModelV4FunctionTool => tool.type !== 'provider');
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

export function createToolPrompt(tool: (LanguageModelV4FunctionTool | LanguageModelV4ProviderTool)) {
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
export function createToolPrompts(tools: (LanguageModelV4FunctionTool | LanguageModelV4ProviderTool)[],
  choice: LanguageModelV4ToolChoice,
  framing: ToolCallFraming = 'tool'): string | undefined {
  // Format tools with their schemas (provider tools are excluded via functionTools)
  const descriptions = functionTools(tools).map(createToolPrompt).join('\n\n');
  const { heading, listHeading, noun } = FRAMING_PRESETS[framing];

  // Format the prompt
  switch (choice.type) {
    case "required":
      // Same text as auto: whether the step must call is said by the agent loop's closing
      // reminder, so dropping to auto (all tools removed) keeps this prompt and its cache.
      return createAutoToolPrompt(heading, listHeading, noun, descriptions);
    case "tool":
      return `${heading}
You must use the ${noun} defined below. Respond ONLY with a JSON object in this exact format:
{ "${noun}": "<${noun}_name>", "arguments": { <parameters> } }

${descriptions}`;
    case "none":
      return undefined;

    default:
      return createAutoToolPrompt(heading, listHeading, noun, descriptions);
  }
}

/**
 * The tool instruction shared by the auto and the unwrapped required choice: how to write a call,
 * then the tool list. It never says whether a call is required.
 */
function createAutoToolPrompt(heading: string, listHeading: string, noun: string, descriptions: string): string {
  return `${heading}
You have access to ${noun}s. To use any of the ${noun}s, ONLY respond with a JSON array in this EXACT format as the text output:
\`\`\`json
[
  { "${noun}": "<${noun}_name>", "arguments": { <parameters> } },
]
\`\`\`

${listHeading}
${descriptions}`;
}

/**
 * Converts tool-call and tool-result messages in a prompt to text-based equivalents.
 * Used in prompt mode so the model sees a consistent text-based conversation history
 * instead of native tool-call/tool-result parts it never produced.
 */
export function convertPromptToolMessagesToText(prompt: LanguageModelV4Prompt, framing: ToolCallFraming = 'tool'): LanguageModelV4Prompt {
  const converted: LanguageModelV4Message[] = [];

  for (const message of prompt) {
    if (message.role === 'assistant') {
      // Convert tool-call/tool-result parts to text in a single pass
      const newContent: typeof message.content = [];
      for (const part of message.content) {
        // Provider-executed parts belong to the host CLI's own tools, not the prompt-emulated
        // game tools. Leave them native so the provider serializes them itself; reframing them
        // as game "actions" would misattribute built-in tool use to the game and corrupt the
        // history the model sees next turn. In assistant content a tool-result part exists only
        // for a provider-executed tool (client results arrive as a separate `tool` role message,
        // handled below), so it is left native as well.
        if (part.type === 'tool-result') {
          newContent.push(part);
          continue;
        }
        if (part.type === 'tool-call') {
          if (part.providerExecuted) {
            newContent.push(part);
            continue;
          }
          // toToolCallObject (inside the formatter) parses a JSON-string input, so pass it raw.
          newContent.push({ type: 'text', text: formatToolCallText(part.toolName, part.input, framing) });
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
