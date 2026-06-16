/**
 * Tests for the OpenAI ChatCompletion → Vercel StepResult format converter.
 */
import { describe, it, expect } from 'vitest';
import { convertToStepResult } from '../../../src/oracle/batch/format-converter.js';

/** Build a minimal ChatCompletion-like response for conversion tests */
function makeResponse(overrides: Record<string, any> = {}): any {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'test-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello world' },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
    ...overrides,
  };
}

describe('convertToStepResult', () => {
  describe('text responses', () => {
    it('should produce a single step with the message text', () => {
      const { steps } = convertToStepResult(makeResponse());
      expect(steps).toHaveLength(1);
      expect(steps[0].text).toBe('Hello world');
      expect(steps[0].toolCalls).toEqual([]);
      expect(steps[0].finishReason).toBe('stop');
    });

    it('should build an assistant response message with a text part', () => {
      const { steps } = convertToStepResult(makeResponse());
      const messages = steps[0].response.messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].content).toEqual([{ type: 'text', text: 'Hello world' }]);
    });

    it('should treat null content as empty text', () => {
      const response = makeResponse();
      response.choices[0].message.content = null;
      const { steps } = convertToStepResult(response);
      expect(steps[0].text).toBe('');
      expect(steps[0].content).toEqual([]);
      // With no content parts, the assistant message falls back to plain text
      expect(steps[0].response.messages[0].content).toBe('');
    });

    it('should map usage token counts', () => {
      const response = makeResponse();
      response.usage.completion_tokens_details = { reasoning_tokens: 3 };
      const { steps } = convertToStepResult(response);
      expect(steps[0].usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        reasoningTokens: 3,
      });
    });

    it('should default usage to zero when absent', () => {
      const response = makeResponse({ usage: undefined });
      const { steps } = convertToStepResult(response);
      expect(steps[0].usage).toEqual({ inputTokens: 0, outputTokens: 0, reasoningTokens: 0 });
    });
  });

  describe('tool call responses', () => {
    /** Response with one function tool call carrying JSON arguments */
    function makeToolResponse(argsJson: string): any {
      const response = makeResponse();
      response.choices[0].message.content = null;
      response.choices[0].message.tool_calls = [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get-data', arguments: argsJson },
        },
      ];
      response.choices[0].finish_reason = 'tool_calls';
      return response;
    }

    it('should convert function tool calls with parsed JSON args', () => {
      const { steps } = convertToStepResult(makeToolResponse('{"playerId": 3}'));
      expect(steps[0].toolCalls).toEqual([
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'get-data',
          args: { playerId: 3 },
        },
      ]);
      expect(steps[0].finishReason).toBe('tool-calls');
      // Tool calls also appear as content parts and in the response message
      expect(steps[0].content).toEqual(steps[0].toolCalls);
      expect(steps[0].response.messages[0].content).toEqual(steps[0].toolCalls);
    });

    it('should keep malformed JSON arguments as the raw string', () => {
      const { steps } = convertToStepResult(makeToolResponse('{not json'));
      expect(steps[0].toolCalls[0].args).toBe('{not json');
    });

    it('should filter out non-function tool calls', () => {
      const response = makeToolResponse('{}');
      response.choices[0].message.tool_calls.push({
        id: 'call_2',
        type: 'custom',
        custom: { name: 'whatever', input: '' },
      });
      const { steps } = convertToStepResult(response);
      expect(steps[0].toolCalls).toHaveLength(1);
      expect(steps[0].toolCalls[0].toolCallId).toBe('call_1');
    });

    it('should combine text and tool call content parts', () => {
      const response = makeToolResponse('{"a":1}');
      response.choices[0].message.content = 'Calling a tool';
      const { steps } = convertToStepResult(response);
      expect(steps[0].content).toHaveLength(2);
      expect(steps[0].content[0]).toEqual({ type: 'text', text: 'Calling a tool' });
      expect(steps[0].content[1].type).toBe('tool-call');
    });
  });

  describe('finish reason mapping', () => {
    /** Convert with a given OpenAI finish_reason and return the mapped value */
    function mapReason(reason: string | null): string {
      const response = makeResponse();
      response.choices[0].finish_reason = reason;
      return convertToStepResult(response).steps[0].finishReason;
    }

    it('should map known reasons to Vercel equivalents', () => {
      expect(mapReason('stop')).toBe('stop');
      expect(mapReason('length')).toBe('length');
      expect(mapReason('tool_calls')).toBe('tool-calls');
      expect(mapReason('content_filter')).toBe('content-filter');
    });

    it('should map unknown or null reasons to unknown', () => {
      expect(mapReason(null)).toBe('unknown');
      expect(mapReason('something_else')).toBe('unknown');
    });
  });

  describe('responses without choices', () => {
    it('should return an empty step preserving usage', () => {
      const response = makeResponse({ choices: [] });
      const { steps } = convertToStepResult(response);
      expect(steps).toHaveLength(1);
      expect(steps[0].text).toBe('');
      expect(steps[0].toolCalls).toEqual([]);
      expect(steps[0].finishReason).toBe('unknown');
      expect(steps[0].usage).toEqual({ inputTokens: 10, outputTokens: 5, reasoningTokens: 0 });
      expect(steps[0].response.messages).toEqual([]);
    });
  });
});
