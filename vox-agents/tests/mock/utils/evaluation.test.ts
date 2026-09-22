/**
 * Tests for the evaluation-model factory: the mocked `@ai-sdk/typesafe-ai`
 * package proves the native path forwards the configured model id, and a
 * MockLanguageModelV4 behind a partial mock of `models.ts` drives the
 * chat-model adapter end to end through `experimental_evaluate`. The real
 * `getModel` rejection for `typesafe` lives in models.test.ts because this
 * file replaces that module's factory.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { experimental_evaluate } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { Experimental_EvaluationModelV4Question } from '@ai-sdk/provider';

// Hoisted holders so the vi.mock factories (which run before imports) can
// record factory calls and serve the scripted chat model.
const sdkMocks = vi.hoisted(() => ({
  createTypeSafeAi: vi.fn(),
  evaluationModel: vi.fn(),
}));

vi.mock('@ai-sdk/typesafe-ai', () => ({
  createTypeSafeAi: (options?: unknown) => {
    sdkMocks.createTypeSafeAi(options);
    return { evaluationModel: sdkMocks.evaluationModel };
  },
  typeSafeAi: { evaluationModel: sdkMocks.evaluationModel },
}));

const modelsMocks = vi.hoisted(() => ({ chatModel: undefined as unknown }));

vi.mock('../../../src/utils/models/models.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/models/models.js')>();
  return {
    ...actual,
    // The adapter pulls its chat model through getModel(); hand it the scripted mock instead.
    getModel: vi.fn(() => modelsMocks.chatModel),
  };
});

import { getEvaluationModel, getEvaluatorConfig } from '../../../src/utils/models/evaluation.js';
import { config } from '../../../src/utils/config.js';
import { createLogger } from '../../../src/utils/logger.js';
import type { ConcurrencyContext } from '../../../src/utils/models/concurrency.js';

/** Question map with one question per supported type. */
const questions = {
  intent: {
    type: 'choice',
    instructions: 'What is the intent?',
    criteria: { deal: 'a deal offer', threat: 'a threat', talk: 'small talk' },
  },
  shift: {
    type: 'score',
    instructions: 'How large is the shift?',
    criteria: ['none', 'minor', 'moderate', 'major'],
  },
  urgent: {
    type: 'boolean',
    instructions: 'Does it need a decision now?',
  },
} satisfies Record<string, Experimental_EvaluationModelV4Question>;

/** Chat configuration served by the mocked models module. */
const chatConfig = { provider: 'openai-compatible', name: 'gpt-oss-120b' };

/** Execution context the adapter receives in place of a live run. */
const context: ConcurrencyContext = { logger: createLogger('evaluation-test'), timeoutRefresh: undefined };

/** Builds a MockLanguageModelV4 stream carrying one text step with token usage. */
function scriptedModel(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: 't1' });
          controller.enqueue({ type: 'text-delta', id: 't1', delta: text });
          controller.enqueue({ type: 'text-end', id: 't1' });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: {
              inputTokens: { total: 7, noCache: 5, cacheRead: 2, cacheWrite: 0 },
              outputTokens: { total: 3, text: 3, reasoning: 0 },
            },
          });
          controller.close();
        },
      }),
    }),
  });
}

describe('evaluation model factory', () => {
  beforeEach(() => {
    sdkMocks.createTypeSafeAi.mockClear();
    sdkMocks.evaluationModel.mockReset();
    modelsMocks.chatModel = undefined;
  });

  describe('getEvaluationModel typesafe provider', () => {
    it('should build the native evaluation model from the configured name', () => {
      const native = { specificationVersion: 'v4' };
      sdkMocks.evaluationModel.mockReturnValue(native);

      const model = getEvaluationModel({ provider: 'typesafe', name: 'jev-latest' });

      expect(sdkMocks.evaluationModel).toHaveBeenCalledWith('jev-latest');
      expect(model).toBe(native as never);
    });
  });

  describe('chat-model adapter', () => {
    it('should evaluate a scripted JSON step into normalized answers with usage', async () => {
      modelsMocks.chatModel = scriptedModel(JSON.stringify({
        intent: { probabilities: { deal: 0.6, threat: 0.3, talk: 0.1 } },
        shift: { probabilities: [0.1, 0.2, 0.3, 0.4] },
        urgent: { probability: 0.7 },
      }));

      const result = await experimental_evaluate({
        model: getEvaluationModel(chatConfig, context),
        state: 'the situation',
        questions,
      });

      expect(result.answers.intent).toMatchObject({ type: 'choice', choice: 'deal' });
      // Weighted mean of 0..3 over [0.1, 0.2, 0.3, 0.4] = 2.0.
      expect(result.answers.shift).toMatchObject({ type: 'score', score: 2 });
      expect(result.answers.urgent).toMatchObject({ type: 'boolean', probability: 0.7 });
      expect(result.usage).toMatchObject({ inputTokens: 7, outputTokens: 3 });
      expect(result.response.modelId).toBe('gpt-oss-120b');
    });

    it('should rescue a fenced partial reply through the lenient parse', async () => {
      modelsMocks.chatModel = scriptedModel([
        '```json',
        '{"intent": {"probabilities": {"deal": 1}}, "shift": {"probabilities": [1, 0, 0, 0]}, "urgent": {"probability": 0}}',
        '```',
      ].join('\n'));

      const result = await experimental_evaluate({
        model: getEvaluationModel(chatConfig, context),
        state: 'the situation',
        questions,
      });

      expect(result.answers.intent).toMatchObject({ type: 'choice', choice: 'deal' });
      expect(result.answers.shift).toMatchObject({ type: 'score', score: 0 });
    });

    it('should reject when the step yields no parsable answer set', async () => {
      modelsMocks.chatModel = scriptedModel('I will not answer in JSON.');

      await expect(experimental_evaluate({
        model: getEvaluationModel(chatConfig, context),
        state: 'the situation',
        questions,
        maxRetries: 0,
      })).rejects.toThrow('openai-compatible/gpt-oss-120b');
    });
  });

  describe('getEvaluatorConfig', () => {
    it('should resolve evaluator assignments from the overrides scope at both keys', () => {
      const evalConfig = { provider: 'typesafe', name: 'jev-latest' };
      expect(getEvaluatorConfig('diplomat', { 'diplomat.evaluator': evalConfig })).toEqual(evalConfig);
      expect(getEvaluatorConfig('diplomat', { evaluator: evalConfig })).toEqual(evalConfig);
      // The agent-scoped key wins over the shared alias, and aliases still chain.
      expect(getEvaluatorConfig('diplomat', {
        'diplomat.evaluator': 'seat-eval',
        evaluator: evalConfig,
        'seat-eval': { provider: 'openai-compatible', name: 'gpt-oss-120b' },
      })).toEqual({ provider: 'openai-compatible', name: 'gpt-oss-120b' });
    });

    it('should resolve evaluator assignments from the global config scope at both keys', () => {
      config.llms['diplomat.evaluator'] = 'typesafe/jev-latest';
      config.llms.evaluator = 'openai-compatible/gpt-oss-120b';
      try {
        expect(getEvaluatorConfig('diplomat')).toEqual({ provider: 'typesafe', name: 'jev-latest' });
        expect(getEvaluatorConfig('strategist')).toEqual({
          provider: 'openai-compatible', name: 'gpt-oss-120b', options: { toolMiddleware: 'prompt' },
        });
      } finally {
        delete config.llms['diplomat.evaluator'];
        delete config.llms.evaluator;
      }
    });

    it('should return undefined when no evaluator is registered rather than falling back to default', () => {
      expect(getEvaluatorConfig('plain-agent')).toBeUndefined();
      expect(getEvaluatorConfig('plain-agent', { 'plain-agent': 'openai/gpt-real' })).toBeUndefined();
    });
  });
});
