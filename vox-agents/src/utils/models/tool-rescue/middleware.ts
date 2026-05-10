/**
 * @module utils/models/tool-rescue/middleware
 *
 * AI SDK middleware that wires the prompt-shaping and text-extraction halves
 * together. In `prompt` mode it injects a JSON-format instruction before the
 * model runs; on the way out it inspects text content and rescues any JSON
 * tool calls the model emitted instead of using native tool-calling.
 */

import { type LanguageModelMiddleware } from 'ai';
import type {
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolCall,
} from '@ai-sdk/provider';
import { createLogger } from '../../logger.js';
import type { ToolRescueOptions } from './types.js';
import { createToolPrompts, convertPromptToolMessagesToText } from './prompt.js';
import { rescueToolCallsFromText } from './extract.js';

const logger = createLogger("tool-rescue");

/**
 * Emits rescued tool calls as stream chunks
 * @param toolCalls Array of rescued tool calls
 * @param controller Transform stream controller
 */
function emitToolCallChunks(
  toolCalls: LanguageModelV3ToolCall[],
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>
): void {
  toolCalls.forEach((toolCall) => {
    controller.enqueue({
      type: 'tool-call',
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      input: toolCall.input
    } as any);
  });
}

/**
 * Emits remaining text as a text-delta chunk
 * @param text Remaining text to emit
 * @param controller Transform stream controller
 * @param id Optional chunk ID
 */
function emitRemainingText(
  text: string | undefined,
  controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
  id: string
): void {
  if (text) {
    controller.enqueue({
      type: 'text-delta',
      delta: text,
      id
    });
  }
}

/**
 * Creates a tool rescue middleware for language models.
 * This middleware intercepts generate operations to detect and transform
 * JSON tool calls embedded in text responses into proper tool-call format.
 *
 * @param options Configuration options
 * @returns A LanguageModelMiddleware that handles tool rescue
 */
export function toolRescueMiddleware(options?: ToolRescueOptions): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3' as const,

    // Transform params if prompt mode is enabled
    transformParams: async ({ params }) => {
      // Skip if prompt mode not enabled or no tools
      if (!options?.prompt || !params?.tools || params.tools.length === 0) {
        return params;
      }

      // Create tool instruction prompt with full tool schemas
      const toolPrompt = createToolPrompts(params.tools, params.toolChoice ?? { type: "auto" });

      // Convert existing tool-call/tool-result messages to text so the model
      // sees a consistent text-based history instead of native tool parts it never produced
      const convertedPrompt = convertPromptToolMessagesToText(params.prompt ?? []);

      // Build the modified prompt, respecting systemPromptFirst models that only
      // accept a single system message. When set, merge the tool prompt into the
      // first existing system message instead of prepending a new one.
      let modifiedPrompt: LanguageModelV3Prompt;
      if (!toolPrompt) {
        modifiedPrompt = convertedPrompt;
      } else if (options?.systemPromptFirst && convertedPrompt.length > 0 && convertedPrompt[0].role === 'system') {
        const firstMsg = convertedPrompt[0] as { role: 'system'; content: string };
        modifiedPrompt = [
          { role: 'system', content: toolPrompt + '\n\n' + firstMsg.content },
          ...convertedPrompt.slice(1)
        ];
      } else {
        modifiedPrompt = [
          { role: 'system', content: toolPrompt },
          ...convertedPrompt
        ];
      }

      // Return modified params without tools (since we're using JSON format)
      const newParams: any = params;
      newParams.originalTools = params.tools;
      newParams.tools = undefined;
      newParams.prompt = modifiedPrompt;
      return newParams;
    },

    wrapGenerate: async ({ doGenerate, params }) => {
      try {
        // Execute the generation (params were already transformed if needed)
        const result = await doGenerate();
        params.tools = params.tools ?? (params as any).originalTools;

        // Process the response to rescue tool calls from JSON text if we have tools but not tool calls
        if (result.content.findIndex(content => content.type === "tool-call") === -1 && params.tools && params.tools.length > 0) {
          // Extract tool names from the tool definitions
          const toolNames = new Set(params.tools.map((tool) => tool.name));
          const newContents: typeof result.content = [];

          // Go through each text respose
          result.content.forEach((content) => {
            if (content.type === "text") {
              const processed = rescueToolCallsFromText(content.text, toolNames);
              // If tool calls were rescued, add them to the content array
              if (processed.toolCalls.length > 0) {
                // Remove the text that contained the tool calls if it was completely consumed
                if (processed.remainingText) newContents.push({ type: 'text', text: processed.remainingText });
                // Add the rescued tool calls to content
                newContents.push(...processed.toolCalls);
                result.finishReason = { unified: 'tool-calls', raw: result.finishReason?.raw };
                return;
              }
            }
            newContents.push(content);
          });

          // Update result with new contents
          result.content = newContents;
        }

        return result;
      } catch (error) {
        // Re-throw the error to let the retry mechanism handle it
        logger.error("Error in wrapGenerate middleware, passing down");
        // Preserve context length errors so they survive the AI SDK's error wrapping
        (params as any).providerOptions.error = error;
        throw error;
      }
    },

    wrapStream: async ({ doStream, params }) => {
      try {
        const { stream, ...rest } = await doStream();
        params.tools = params.tools ?? (params as any).originalTools;

        // If we don't have tools, just pass through the stream
        if (!params.tools || params.tools.length === 0) {
          return { stream, ...rest };
        }

        // Extract tool names from the tool definitions
        const toolNames = new Set(params.tools.map((tool) => tool.name));

        // Track if we've already found tool calls
        let toolCallsFound = false;
        // Buffer for incomplete JSON
        let incompleteBuffers: Record<string, string> = {};

        const transformStream = new TransformStream<
          LanguageModelV3StreamPart,
          LanguageModelV3StreamPart
        >({
          transform(chunk, controller) {
            switch (chunk.type) {
              case "text-delta": {
                // Process the incoming delta
                let incompleteBuffer = incompleteBuffers[chunk.id] ?? "";
                let currentDelta = incompleteBuffer + chunk.delta;

                // Check for JSON start characters and delimiter-based tool call markers
                const objStartIndex = currentDelta.indexOf('{');
                const arrStartIndex = currentDelta.indexOf('[');
                const markdownStartIndex = currentDelta.indexOf('```json');
                const delimiterStartIndex = currentDelta.indexOf('<|tool_call');
                let jsonStartIndex = -1;

                // Find the earliest occurrence of any start marker
                const candidates = [
                  markdownStartIndex,
                  objStartIndex,
                  arrStartIndex,
                  delimiterStartIndex
                ].filter(i => i !== -1);

                if (candidates.length > 0) {
                  jsonStartIndex = Math.min(...candidates);
                } else {
                  chunk.delta = currentDelta;
                }

                if (jsonStartIndex !== -1) {
                  // Output text before JSON, start buffering from JSON
                  chunk.delta = currentDelta.substring(0, jsonStartIndex);
                  incompleteBuffer = currentDelta.substring(jsonStartIndex);

                  if (!incompleteBuffer.startsWith('```json')) {
                    // Try to rescue tool calls from accumulated buffer - strict first
                    const processed = rescueToolCallsFromText(incompleteBuffer, toolNames, false);
                    if (processed.toolCalls.length > 0) {
                      toolCallsFound = true;
                      // Emit tool calls as proper stream chunks
                      emitToolCallChunks(processed.toolCalls, controller);
                      // Clear the buffer and put remaining text there
                      let remaining = processed.remainingText ?? "";
                      if (remaining.indexOf("{") !== -1 || remaining.indexOf("<|tool_call") !== -1)
                        incompleteBuffers[chunk.id] = remaining;
                      else {
                        incompleteBuffers[chunk.id] = "";
                        chunk.delta += remaining;
                      }
                    } else {
                      incompleteBuffers[chunk.id] = incompleteBuffer;
                    }
                  } else {
                    incompleteBuffers[chunk.id] = incompleteBuffer;
                  }
                }

                // Pass through the remaining text
                controller.enqueue(chunk);
                break;
              }
              case "text-end": {
                // Text block ended, pass through
                let incompleteBuffer = incompleteBuffers[chunk.id] ?? "";
                if (incompleteBuffer !== "") {
                  // More lenient when the stream is finishing
                  const processed = rescueToolCallsFromText(incompleteBuffer, toolNames);
                  if (processed.toolCalls.length > 0) {
                    toolCallsFound = true;
                    // Emit remaining text if any
                    emitRemainingText(processed.remainingText, controller, chunk.id);
                    // Emit tool calls
                    emitToolCallChunks(processed.toolCalls, controller);
                  } else {
                    emitRemainingText(incompleteBuffer, controller, chunk.id);
                  }
                }
                controller.enqueue(chunk);
                break;
              }
              case "finish": {
                // Update finish reason if we found tool calls
                if (toolCallsFound) {
                  controller.enqueue({
                    ...chunk,
                    finishReason: { unified: 'tool-calls', raw: chunk.finishReason?.raw }
                  });
                } else {
                  controller.enqueue(chunk);
                }
                break;
              }

              default: {
                // Pass through other chunks unchanged
                controller.enqueue(chunk);
                break;
              }
            }
          }
        });

        return {
          stream: stream.pipeThrough(transformStream),
          ...rest,
        };
      } catch (error) {
        // Re-throw the error to let the retry mechanism handle it
        logger.error("Error in wrapStream middleware, passing down");
        // Preserve context length errors so they survive the AI SDK's error wrapping
        (params as any).providerOptions.error = error;
        throw error;
      }
    }
  };
}
