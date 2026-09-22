/**
 * @module oracle/batch/format-converter
 *
 * Converts OpenAI ChatCompletion responses to the Vercel AI SDK StepResult
 * shape used by streamTextWithConcurrency. This is the final conversion
 * step that allows batch results to be consumed identically to streaming.
 *
 * Provider-specific input conversions (Vercel → OpenAI, Vercel → Google)
 * live in the respective provider modules under providers/.
 */

import type { ModelMessage } from 'ai';
import type { ChatCompletion } from './types.js';

// ── OpenAI → Vercel Conversion ──

/**
 * Convert an OpenAI ChatCompletion response into the shape that
 * streamTextWithConcurrency returns. This allows VoxContext to consume
 * batch results identically to real-time streaming results.
 *
 * The returned object has a `steps` array with a single StepResult
 * containing text, toolCalls, usage, and response messages.
 *
 * @param response - OpenAI chat completion response
 * @returns Object matching streamTextWithConcurrency's return type
 */
export function convertToStepResult(response: ChatCompletion): {
  steps: any[];
} {
  const choice = response.choices[0];
  if (!choice) {
    return { steps: [createEmptyStep(response)] };
  }

  const message = choice.message;

  // Extract text content
  const text = message.content ?? '';

  // Convert OpenAI tool calls to Vercel ToolCallPart format.
  // tool_calls is a union of function and custom tool calls;
  // we only handle function calls (type === 'function').
  const toolCalls = (message.tool_calls ?? [])
    .filter((tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function')
    .map(tc => ({
      type: 'tool-call' as const,
      toolCallId: tc.id,
      toolName: tc.function.name,
      args: safeParseJson(tc.function.arguments),
    }));

  // Build response messages in Vercel format
  const responseMessages: ModelMessage[] = [];

  // Build assistant message content parts
  const contentParts: any[] = [];
  if (text) {
    contentParts.push({ type: 'text', text });
  }
  for (const tc of toolCalls) {
    contentParts.push(tc);
  }

  responseMessages.push({
    role: 'assistant',
    content: contentParts.length > 0 ? contentParts : text,
  } as ModelMessage);

  // Build the StepResult-like object
  const step = {
    text,
    reasoning: [],
    reasoningText: undefined,
    files: [],
    sources: [],
    content: contentParts,
    toolCalls,
    staticToolCalls: [],
    dynamicToolCalls: [],
    toolResults: [],
    staticToolResults: [],
    dynamicToolResults: [],
    finishReason: mapFinishReason(choice.finish_reason),
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      outputTokenDetails: {
        reasoningTokens: response.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      },
    },
    warnings: undefined,
    request: {},
    response: {
      messages: responseMessages,
    },
    providerMetadata: undefined,
  };

  return { steps: [step] };
}

/**
 * Create an empty step result for responses with no choices.
 *
 * @param response - The original response (for usage data)
 * @returns A minimal StepResult-like object
 */
function createEmptyStep(response: ChatCompletion): any {
  return {
    text: '',
    reasoning: [],
    reasoningText: undefined,
    files: [],
    sources: [],
    content: [],
    toolCalls: [],
    staticToolCalls: [],
    dynamicToolCalls: [],
    toolResults: [],
    staticToolResults: [],
    dynamicToolResults: [],
    finishReason: 'unknown',
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      outputTokenDetails: { reasoningTokens: 0 },
    },
    warnings: undefined,
    request: {},
    response: { messages: [] },
    providerMetadata: undefined,
  };
}

/**
 * Map OpenAI finish_reason to Vercel AI SDK FinishReason.
 *
 * @param reason - OpenAI finish reason string
 * @returns Vercel-compatible finish reason
 */
function mapFinishReason(reason: string | null): string {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'tool_calls': return 'tool-calls';
    case 'content_filter': return 'content-filter';
    default: return 'unknown';
  }
}

/**
 * Safely parse a JSON string, returning the raw string on failure.
 *
 * @param str - JSON string to parse
 * @returns Parsed object or the original string
 */
function safeParseJson(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
