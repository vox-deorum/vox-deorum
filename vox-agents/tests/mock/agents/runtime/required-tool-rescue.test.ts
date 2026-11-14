/**
 * Mock-tier tests for a step that skips a required tool call.
 *
 * The AI SDK flags that step with AI_ToolChoiceViolationError but still resolves it. These cover
 * the two halves of our handling: streamTextWithConcurrency returns the step once, without a retry
 * or console output, and VoxAgent.prepareStep keeps a reply that had text (reasoning included)
 * while stripping an empty or reasoning-only one before appending the rescue prompt.
 *
 * Agents are loaded through the agent-registry to avoid circular-import hazards.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonSchema, tool, type ModelMessage } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import '../../../../src/agents/runtime/agent-registry.js';
import { agentRegistry } from '../../../../src/agents/runtime/agent-registry.js';
import { streamTextWithConcurrency } from '../../../../src/agents/models/concurrency.js';
import { logger } from '../../../../src/utils/logger.js';
import { createFakeVoxContext, makeStrategistParameters } from '../../../helpers/fake-vox-context.js';

/** Build a mock model whose every call answers with reasoning and plain text, never a tool call. */
function textOnlyModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'reasoning-start', id: 'r' },
          { type: 'reasoning-delta', id: 'r', delta: 'thinking' },
          { type: 'reasoning-end', id: 'r' },
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: 'answer' },
          { type: 'text-end', id: 't' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
          },
        ] as any,
      }),
    }),
  });
}

/** Build the minimal last step prepareStep reads: no tool calls, the given text and replies. */
function stepWithoutToolCall(text: string, responseMessages: ModelMessage[]) {
  return { text, toolCalls: [], response: { messages: responseMessages } } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('required tool choice violations', () => {
  describe('streamTextWithConcurrency', () => {
    it('should resolve the step once with its reasoning and text and no console output', async () => {
      const model = textOnlyModel();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result: any = await streamTextWithConcurrency({
        model,
        prompt: 'hi',
        maxRetries: 0,
        tools: { act: tool({ inputSchema: jsonSchema({ type: 'object' }), execute: async () => 'ok' }) },
        toolChoice: 'required',
        stopWhen: () => true,
      } as any, { logger, timeoutRefresh: undefined });

      expect(model.doStreamCalls).toHaveLength(1);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].toolCalls).toHaveLength(0);
      expect(result.steps[0].reasoningText).toBe('thinking');
      expect(result.steps[0].text).toBe('answer');
      expect(consoleError).not.toHaveBeenCalled();
    });
  });

  describe('VoxAgent.prepareStep', () => {
    const agent = agentRegistry.get('negotiator') as any;
    const parameters = makeStrategistParameters();
    const base: ModelMessage[] = [{ role: 'user', content: 'decide' }];

    it('should keep a reply that had text and append the rescue after it', async () => {
      const reply: ModelMessage = {
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'answer' }],
      };
      const lastStep = stepWithoutToolCall('answer', [reply]);

      const config = await agent.prepareStep(parameters, {}, lastStep, [lastStep], [...base, reply],
        createFakeVoxContext().asContext());

      expect(config.messages).toHaveLength(3);
      expect(config.messages[1]).toBe(reply);
      expect(config.messages[2].role).toBe('user');
    });

    it('should strip a reasoning-only reply before appending the rescue', async () => {
      const reply: ModelMessage = { role: 'assistant', content: [{ type: 'reasoning', text: 'thinking' }] };
      const lastStep = stepWithoutToolCall('', [reply]);

      const config = await agent.prepareStep(parameters, {}, lastStep, [lastStep], [...base, reply],
        createFakeVoxContext().asContext());

      expect(config.messages).toHaveLength(2);
      expect(config.messages).not.toContain(reply);
      expect(config.messages[1].role).toBe('user');
    });

    it('should strip a reply whose text was all cleaned away as tool artifacts', async () => {
      // stripToolArtifacts already emptied the joined copy, so the raw step text no longer counts.
      const reply: ModelMessage = { role: 'assistant', content: [] };
      const lastStep = stepWithoutToolCall('<tool_call>{}</tool_call>', [reply]);

      const config = await agent.prepareStep(parameters, {}, lastStep, [lastStep], [...base, reply],
        createFakeVoxContext().asContext());

      expect(config.messages).toHaveLength(2);
      expect(config.messages).not.toContain(reply);
    });
  });
});
