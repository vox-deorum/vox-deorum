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
import { errorMessage } from '../../utils/errors.js';

// ── OpenAI → Vercel Conversion ──

/**
 * Per-tool input hooks in the shape of `streamText`'s `experimental_refineToolInput`: each runs on
 * its tool's parsed input and returns the refined input, or throws to reject the call.
 */
export type RefineToolInput = Record<string, ((input: any) => unknown) | undefined>;

/**
 * Convert an OpenAI ChatCompletion response into the shape that
 * streamTextWithConcurrency returns. This allows VoxContext to consume
 * batch results identically to real-time streaming results.
 *
 * The returned object has a `steps` array with a single StepResult
 * containing text, toolCalls, usage, and response messages.
 *
 * `refineToolInput` gets the same treatment `streamText` gives it, since the batch path never runs
 * the SDK: a hook that throws marks only that call invalid and answers it with an error result
 * (which is how a tool removed for the step is rejected), and a hook that returns replaces the input.
 *
 * @param response - OpenAI chat completion response
 * @param refineToolInput - The step's `experimental_refineToolInput` map, when it passed one
 * @returns Object matching streamTextWithConcurrency's return type
 */
export async function convertToStepResult(response: ChatCompletion, refineToolInput?: RefineToolInput): Promise<{
  steps: any[];
}> {
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
  const toolCalls: any[] = [];
  const toolErrors: any[] = [];
  for (const tc of message.tool_calls ?? []) {
    if (tc.type !== 'function') continue;
    const call = await refineToolCall({
      type: 'tool-call' as const,
      toolCallId: tc.id,
      toolName: tc.function.name,
      input: safeParseJson(tc.function.arguments),
    }, refineToolInput);
    toolCalls.push(call);
    if (call.invalid) {
      toolErrors.push({
        type: 'tool-error',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
        error: call.error,
        dynamic: true,
      });
    }
  }

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
    content: contentParts.length > 0
      ? contentParts.map(part => part.type === 'tool-call' ? toToolCallMessagePart(part) : part)
      : text,
  } as ModelMessage);

  // A rejected call is answered with its error, as streamText's response messages do, so the
  // next step sees why it did not run.
  if (toolErrors.length > 0) {
    responseMessages.push({
      role: 'tool',
      content: toolErrors.map(error => ({
        type: 'tool-result',
        toolCallId: error.toolCallId,
        toolName: error.toolName,
        output: { type: 'error-text', value: errorMessage(error.error) },
      })),
    } as ModelMessage);
  }
  contentParts.push(...toolErrors);

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
 * Run a call through its refine hook the way streamText does: a throw returns the call marked
 * invalid with the error, and a return replaces its input. Calls without a hook pass through.
 */
async function refineToolCall(call: any, refineToolInput: RefineToolInput | undefined): Promise<any> {
  const refine = refineToolInput && Object.hasOwn(refineToolInput, call.toolName)
    ? refineToolInput[call.toolName]
    : undefined;
  if (!refine) return call;
  try {
    return { ...call, input: await refine(call.input) };
  } catch (error) {
    return { ...call, dynamic: true, invalid: true, error };
  }
}

/** The assistant-message form of a tool call, without the step-only invalid/error fields. */
function toToolCallMessagePart(call: any): any {
  return { type: 'tool-call', toolCallId: call.toolCallId, toolName: call.toolName, input: call.input };
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
