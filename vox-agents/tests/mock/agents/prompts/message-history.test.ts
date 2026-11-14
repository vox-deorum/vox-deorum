/**
 * Mock-tier unit tests for the run-history compaction helpers in
 * `src/agents/prompts/message-history.ts`, together with the request estimator and threshold
 * resolver the step loop pairs them with (`countRequestTokens` in `src/agents/models/token-counter.ts`
 * and `continuityThreshold` in `src/agents/models/models.ts`). Assertions compare against the
 * exported stub constant and token-count direction, never against prompt wording.
 */

import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  compactWorkspaceTraffic,
  dropOlderReasoning,
  droppedOutputStub,
} from '../../../../src/agents/prompts/message-history.js';
import { countRequestTokens } from '../../../../src/agents/models/token-counter.js';
import {
  continuityThreshold,
  defaultContinuityThreshold,
  largeContinuityThreshold,
} from '../../../../src/agents/models/models.js';
import { bashToolName } from '../../../../src/agents/tools/tool-names.js';
import type { Model } from '../../../../src/types/index.js';

/** An assistant message carrying the given content parts. */
function assistant(parts: unknown[]): ModelMessage {
  return { role: 'assistant', content: parts } as ModelMessage;
}

/** A user message with plain string content. */
function user(text: string): ModelMessage {
  return { role: 'user', content: text } as ModelMessage;
}

/** A bash tool-call part paired with the given call id. */
function bashCall(callId: string, command = `echo ${callId}`): unknown {
  return { type: 'tool-call', toolCallId: callId, toolName: bashToolName, input: { command } };
}

/** A plain-text assistant content part. */
function textPart(text: string): unknown {
  return { type: 'text', text };
}

/** A reasoning content part. */
function reasoningPart(text: string): unknown {
  return { type: 'reasoning', text };
}

/** A tool message with one text-output result for the given tool and call id. */
function toolResult(toolName: string, callId: string, value: string): ModelMessage {
  return {
    role: 'tool',
    content: [{ type: 'tool-result', toolCallId: callId, toolName, output: { type: 'text', value } }],
  } as ModelMessage;
}

/** A bash tool message with the given output value. */
function bashResult(callId: string, value: string): ModelMessage {
  return toolResult(bashToolName, callId, value);
}

/** Repeated filler; each "x " pair is roughly one o200k token. */
function filler(pairs: number): string {
  return 'x '.repeat(pairs);
}

/** The tool-result part for a call id inside a message, or undefined. */
function resultPart(message: ModelMessage, callId: string): any {
  return (message.content as any[]).find((part) => part.type === 'tool-result' && part.toolCallId === callId);
}

describe('message history compaction', () => {
  describe('compactWorkspaceTraffic', () => {
    /** A run history mixing bash and non-bash traffic around the keepFrom boundary. */
    function history(): ModelMessage[] {
      return [
        user('kick off'), // 0
        assistant([bashCall('b1'), textPart('running a command')]), // 1
        bashResult('b1', 'first output'), // 2
        toolResult('get-briefing', 'g1', 'briefing body'), // 3
        assistant([bashCall('b2')]), // 4
        bashResult('b2', 'second output'), // 5
        user('thanks'), // 6
      ];
    }

    it('should stub bash outputs before keepFrom and keep bash results at or after it', () => {
      const messages = history();
      const result = compactWorkspaceTraffic(messages, 5);
      expect(resultPart(result[2], 'b1').output).toEqual({ type: 'text', value: droppedOutputStub });
      // The stubbed message is a copy; the kept one passes through as is.
      expect(result[2]).not.toBe(messages[2]);
      expect(result[5]).toBe(messages[5]);
      expect(resultPart(result[5], 'b2').output).toEqual({ type: 'text', value: 'second output' });
    });

    it('should leave non-bash tool results and all other messages unchanged', () => {
      const messages = history();
      const result = compactWorkspaceTraffic(messages, 3);
      expect(result[0]).toBe(messages[0]);
      expect(result[1]).toBe(messages[1]);
      expect(result[3]).toBe(messages[3]);
      expect(resultPart(result[3], 'g1').output).toEqual({ type: 'text', value: 'briefing body' });
      expect(result[6]).toBe(messages[6]);
    });

    it('should leave bash outputs before the from index unchanged', () => {
      const messages = history();
      const result = compactWorkspaceTraffic(messages, 6, 3);
      expect(result[2]).toBe(messages[2]);
      expect(resultPart(result[5], 'b2').output).toEqual({ type: 'text', value: droppedOutputStub });
    });

    it('should pass an already stubbed result through as is', () => {
      const once = compactWorkspaceTraffic(history(), 5);
      const twice = compactWorkspaceTraffic(once, 5);
      expect(twice[2]).toBe(once[2]);
    });

    it('should keep tool-call parts so call/result pairs stay valid', () => {
      const messages = history();
      const result = compactWorkspaceTraffic(messages, 5);
      const calls = (result[1].content as any[]).filter((part) => part.type === 'tool-call');
      expect(calls.map((call) => call.toolCallId)).toEqual(['b1']);
      expect(resultPart(result[2], 'b1')).toBeDefined();
    });

    it('should not mutate the input array or its messages', () => {
      const messages = history();
      const snapshot = structuredClone(messages);
      const result = compactWorkspaceTraffic(messages, 3);
      expect(messages).toEqual(snapshot);
      expect(result).not.toBe(messages);
    });
  });

  describe('dropOlderReasoning', () => {
    /** A history with reasoning-bearing assistants at indices 1, 2, and 3 (the latest). */
    function history(): ModelMessage[] {
      return [
        user('question'), // 0
        assistant([reasoningPart('old thought'), textPart('old answer')]), // 1
        assistant([reasoningPart('only reasoning')]), // 2
        assistant([reasoningPart('latest thought'), bashCall('b1')]), // 3
      ];
    }

    it('should keep reasoning only on the most recent assistant message', () => {
      const messages = history();
      const result = dropOlderReasoning(messages, 0);
      // The older text-bearing assistant survives without its reasoning, as a copy.
      const older = result.find((m) => m !== messages[3] && m !== messages[0] && m.role === 'assistant')!;
      expect(older).not.toBe(messages[1]);
      expect((older.content as any[]).some((part) => part.type === 'reasoning')).toBe(false);
      expect((older.content as any[]).some((part) => part.type === 'text')).toBe(true);
      // The most recent assistant is kept as is, reasoning included.
      expect(result).toContain(messages[3]);
      expect((messages[3].content as any[]).some((part) => part.type === 'reasoning')).toBe(true);
    });

    it('should remove an assistant message that has nothing left once its reasoning drops', () => {
      const messages = history();
      const result = dropOlderReasoning(messages, 0);
      // user + older assistant (text kept) + latest assistant; the reasoning-only message is gone.
      expect(result).toHaveLength(3);
      expect(result).not.toContain(messages[2]);
      expect(result).toContain(messages[0]);
      expect(result).toContain(messages[3]);
    });

    it('should keep reasoning on messages before the from index', () => {
      const messages = history();
      const result = dropOlderReasoning(messages, 2);
      // Index 1 is before `from`, so it passes through untouched, reasoning and all.
      expect(result[1]).toBe(messages[1]);
      expect((result[1].content as any[]).some((part) => part.type === 'reasoning')).toBe(true);
      // Index 2 is at or after `from` and holds only reasoning, so it is dropped.
      expect(result).toHaveLength(3);
      expect(result).not.toContain(messages[2]);
      // The latest assistant keeps its reasoning.
      expect(result[2]).toBe(messages[3]);
    });

    it('should not mutate the input array or its messages', () => {
      const messages = history();
      const snapshot = structuredClone(messages);
      dropOlderReasoning(messages, 0);
      expect(messages).toEqual(snapshot);
    });
  });

  describe('countRequestTokens', () => {
    it('should grow when a tool-result output grows', () => {
      const small = countRequestTokens([bashResult('b1', 'short output')]);
      const large = countRequestTokens([bashResult('b1', filler(2000))]);
      expect(large).toBeGreaterThan(small);
    });

    it('should grow when an assistant message carries reasoning', () => {
      const without = countRequestTokens([assistant([textPart('the answer')])]);
      const withReasoning = countRequestTokens([assistant([reasoningPart(filler(2000)), textPart('the answer')])]);
      expect(withReasoning).toBeGreaterThan(without);
    });

    it('should grow when a tool-call input grows', () => {
      const small = countRequestTokens([assistant([bashCall('b1', 'ls')])]);
      const large = countRequestTokens([assistant([bashCall('b1', filler(2000))])]);
      expect(large).toBeGreaterThan(small);
    });
  });

  describe('continuityThreshold', () => {
    /** A model config shaped for threshold resolution, with an optional explicit threshold. */
    function modelConfig(provider: string, name: string, continuityThresholdValue?: unknown): Model {
      const options: Record<string, any> | undefined =
        continuityThresholdValue === undefined ? undefined : { continuityThreshold: continuityThresholdValue };
      return { provider, name, options } as Model;
    }

    it('should give the large default to Anthropic, OpenAI, Codex, and Claude Code providers', () => {
      for (const provider of ['anthropic', 'openai', 'codex', 'claude-code']) {
        expect(continuityThreshold(modelConfig(provider, 'latest-model'))).toBe(largeContinuityThreshold);
      }
    });

    it('should give the large default to claude and openai names on routers and Vertex', () => {
      expect(continuityThreshold(modelConfig('openrouter', 'anthropic/claude-x'))).toBe(largeContinuityThreshold);
      expect(continuityThreshold(modelConfig('openrouter', 'openai/gpt-x'))).toBe(largeContinuityThreshold);
      expect(continuityThreshold(modelConfig('google', 'claude-x'))).toBe(largeContinuityThreshold);
    });

    it('should give the default threshold to other router models', () => {
      expect(continuityThreshold(modelConfig('openrouter', 'qwen/qwen3'))).toBe(defaultContinuityThreshold);
      expect(continuityThreshold(modelConfig('google', 'gemini-x'))).toBe(defaultContinuityThreshold);
    });

    it('should honor an explicit threshold over the provider default', () => {
      expect(continuityThreshold(modelConfig('anthropic', 'claude-x', 5000))).toBe(5000);
      expect(continuityThreshold(modelConfig('openrouter', 'qwen/qwen3', 5000))).toBe(5000);
    });

    it('should fall back to the provider default for non-positive, non-finite, or non-numeric values', () => {
      for (const value of [0, -1, NaN, Infinity, '5000']) {
        expect(continuityThreshold(modelConfig('openrouter', 'qwen/qwen3', value))).toBe(defaultContinuityThreshold);
        expect(continuityThreshold(modelConfig('anthropic', 'claude-opus', value))).toBe(largeContinuityThreshold);
      }
    });
  });
});
