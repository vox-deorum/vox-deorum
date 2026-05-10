/**
 * @module utils/models/tool-rescue/prompt
 *
 * Prompt-shaping helpers used when a model lacks native tool calling.
 * Generates the system prompt that teaches the model the JSON tool-call
 * format, and rewrites prior tool-call/tool-result message parts to plain
 * text so the conversation history matches what the model actually produces.
 */

import {
  LanguageModelV3FunctionTool,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3ProviderTool,
  LanguageModelV3ToolChoice,
} from '@ai-sdk/provider';
import { formatToolCallText, formatToolResultOutput } from '../text-cleaning.js';

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
  choice: LanguageModelV3ToolChoice): string | undefined {
  // Format tools with their schemas
  const descriptions = tools.map(createToolPrompt).join('\n\n');

  // Format the prompt
  switch (choice.type) {
    case "required":
      return `## Tool Calling
You must use one or more tools from the list below. Respond ONLY with a JSON array in this exact format:
\`\`\`json
[
  { "tool": "<tool_name>", "arguments": { <parameters> } },
]
\`\`\`

## Available Tools
${descriptions}`;
    case "tool":
      return `## Tool Calling
You must use the tool defined below. Respond ONLY with a JSON object in this exact format:
{ "tool": "<tool_name>", "arguments": { <parameters> } }

${descriptions}`;
    case "none":
      return undefined;

    default:
      return `## Tool Calling
You have access to tools. If you decide to invoke any of the tool(s), ONLY respond with a JSON array in this EXACT format as the text output:
\`\`\`json
[
  { "tool": "<tool_name>", "arguments": { <parameters> } },
]
\`\`\`

## Available Tools
${descriptions}`;
  }
}

/**
 * Converts tool-call and tool-result messages in a prompt to text-based equivalents.
 * Used in prompt mode so the model sees a consistent text-based conversation history
 * instead of native tool-call/tool-result parts it never produced.
 */
export function convertPromptToolMessagesToText(prompt: LanguageModelV3Prompt): LanguageModelV3Prompt {
  const converted: LanguageModelV3Message[] = [];

  for (const message of prompt) {
    if (message.role === 'assistant') {
      // Convert tool-call/tool-result parts to text in a single pass
      const newContent: typeof message.content = [];
      for (const part of message.content) {
        if (part.type === 'tool-call') {
          let args = part.input;
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { /* keep as-is */ }
          }
          newContent.push({ type: 'text', text: formatToolCallText(part.toolName, args) });
          continue;
        } else if (part.type === 'tool-result') {
          const formatted = formatToolResultOutput(part);
          if (formatted) newContent.push({ type: 'text', text: formatted });
          continue;
        }
        newContent.push(part);
      }

      converted.push({ ...message, content: newContent });

    } else if (message.role === 'tool') {
      // Convert tool message to user message with text content
      const textParts = message.content
        .filter(part => part.type === 'tool-result')
        .map(part => formatToolResultOutput(part))
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
