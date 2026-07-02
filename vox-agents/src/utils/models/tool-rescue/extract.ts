/**
 * @module utils/models/tool-rescue/extract
 *
 * Parses JSON tool calls embedded in free-form model text. Supports
 * markdown code blocks, raw JSON arrays/objects, and the
 * `<|tool_call_begin|>...<|tool_call_end|>` delimiter format. Returns
 * the rescued tool calls plus any leftover text that wasn't consumed.
 */

import type { LanguageModelV3ToolCall } from '@ai-sdk/provider';
// @ts-ignore - jaison doesn't have type definitions
import jaison from 'jaison';
import { createLogger } from '../../logger.js';

const logger = createLogger("tool-rescue");

// Simple ID generator
function generateId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Rescues tool calls from JSON text and transforms them into proper tool call format.
 * This function processes text that may contain JSON tool calls and converts them
 * to the format expected by the AI SDK.
 *
 * @param text The text to process
 * @param availableTools Set of available tool names for validation
 * @returns Object containing rescued tool calls and remaining text (if any)
 */
export function rescueToolCallsFromText(
  text: string,
  availableTools: Set<string>,
  useJaison: boolean = true
): { remainingText?: string, toolCalls: LanguageModelV3ToolCall[] } {
  // Check for delimiter-based tool call format: <|tool_call_begin|> functions.name:N <|tool_call_argument_begin|> {...} <|tool_call_end|>
  const delimiterRegex = /<\|tool_call_begin\|>\s*(?:functions\.)?(.+?)(?::(\d+))?\s*<\|tool_call_argument_begin\|>\s*([\s\S]*?)\s*<\|tool_call_end\|>/g;
  let delimiterMatch;
  const delimiterToolCalls: LanguageModelV3ToolCall[] = [];
  let remainingAfterDelimiters = text;

  while ((delimiterMatch = delimiterRegex.exec(text)) !== null) {
    const rawToolName = delimiterMatch[1].trim().replaceAll(/_/g, '-');
    const argsText = delimiterMatch[3].trim();

    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = jaison(argsText);
    } catch {
      if (useJaison) logger.log("warn", `Failed to parse delimiter tool call arguments for ${rawToolName}: ${argsText}`);
      continue;
    }

    if (!availableTools.has(rawToolName)) {
      if (useJaison) logger.log("warn", `Failed to rescue delimiter tool call: non-existent or unavailable tool ${rawToolName}`, parsedArgs);
      continue;
    }

    logger.log("debug", `Rescued delimiter tool call: ${rawToolName}`, parsedArgs);
    delimiterToolCalls.push({
      type: 'tool-call',
      toolCallId: generateId(),
      toolName: rawToolName,
      input: JSON.stringify(parsedArgs),
    });
  }

  if (delimiterToolCalls.length > 0) {
    // Remove matched delimiter blocks and orphaned section markers from text
    remainingAfterDelimiters = text.replace(delimiterRegex, '')
      .trim() || undefined!;
    return { toolCalls: delimiterToolCalls, remainingText: remainingAfterDelimiters || undefined };
  }

  // Define common field name patterns to check. Both 'tool' and 'action' keys are
  // always accepted (framing-agnostic): the 'action' key is what the claude-code
  // provider's prompt instructs; tool-name validation below keeps this safe.
  const fieldPatterns = [
    { nameField: 'name', parametersField: 'parameters' },
    { nameField: 'toolName', parametersField: 'input' },
    { nameField: 'tool', parametersField: 'arguments' },
    { nameField: 'action', parametersField: 'arguments' }
  ];

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
  const codeBlockRegex = /\`\`\`json\s*\n([\s\S]*?)\n\`\`\`/;
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

  // Check if it's an array of tool calls
  const toolCalls = Array.isArray(parsed) ? parsed : [parsed];
  let allToolCallsValid = true;
  const rescuedToolCalls: LanguageModelV3ToolCall[] = [];

  for (const toolCall of toolCalls) {
    if (!toolCall) continue;

    // Try each field pattern to find valid tool call structure
    let toolName: string | undefined;
    let toolParameters: Record<string, unknown> | undefined;
    let patternFound = false;

    for (const pattern of fieldPatterns) {
      const candidateName = toolCall[pattern.nameField];
      const candidateParams = toolCall[pattern.parametersField];

      if (candidateName && candidateParams) {
        toolName = candidateName?.replaceAll(/_/g, '-');
        toolParameters = candidateParams;
        patternFound = true;
        break;
      }
    }

    if (!patternFound) {
      if (Object.keys(toolCall).length > 0 && useJaison)
        logger.log("warn", `Failed to rescue tool call: no matching field pattern found from ${jsonText}`);
      continue;
    }

    // Check if the tool exists in available tools
    if (!availableTools.has(toolName!)) {
      if (useJaison) logger.log("warn", `Failed to rescue tool call: non-existent or unavailable tool ${toolName}`, toolParameters);
      continue;
    }

    logger.log("debug", `Rescued tool call: ${toolName}`, toolParameters!);

    // Transform into a tool call
    rescuedToolCalls.push({
      type: 'tool-call',
      toolCallId: generateId(),
      toolName: toolName!,
      input: JSON.stringify(toolParameters),
    });
  }

  // Only return the rescued tool calls if all were valid
  if (rescuedToolCalls.length > 0 && allToolCallsValid) {
    // If we extracted a JSON block, calculate remaining text
    let remainingText: string | undefined;

    // Determine what was extracted - either the full markdown block or just the JSON content
    const extractedContent = codeBlockMatch ? codeBlockMatch[0] : jsonText;

    if (extractedContent && extractedContent !== text) {
      // Remove the extracted content from the original text
      const blockIndex = text.indexOf(extractedContent);
      const before = text.substring(0, blockIndex).trim();
      const after = text.substring(blockIndex + extractedContent.length).trim();
      remainingText = (before + ' ' + after).trim();
      if (!remainingText) remainingText = undefined;
    }

    return { toolCalls: rescuedToolCalls, remainingText };
  }

  // If rescue failed, return original text
  return { toolCalls: [], remainingText: text };
}
