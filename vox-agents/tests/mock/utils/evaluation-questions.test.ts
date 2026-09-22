/**
 * Tests for the pure evaluation-question helpers: schema construction, prompt
 * assembly, and answer normalization. These helpers deliberately avoid mocks,
 * so the normalization contract is also checked end to end by feeding a stub
 * evaluation model through `experimental_evaluate`.
 */
import { describe, expect, it } from 'vitest';
import { experimental_evaluate } from 'ai';
import type {
  Experimental_EvaluationModelV4,
  Experimental_EvaluationModelV4Question,
} from '@ai-sdk/provider';
import {
  buildEvaluatorPrompt,
  coerceEvaluationInput,
  normalizeAnswers,
  questionsToSchema,
} from '../../../src/utils/models/evaluation-questions.js';

/** One question map covering all three question types, reused across the suites. */
const questions = {
  intent: {
    type: 'choice',
    instructions: 'What is the intent of this message?',
    criteria: { deal: 'a deal offer', threat: 'an explicit threat', talk: null },
  },
  shift: {
    type: 'score',
    instructions: 'How large is the strategic shift?',
    criteria: ['no change', 'minor change', 'major change'],
  },
  urgent: {
    type: 'boolean',
    instructions: 'Does this need a decision right now?',
    criteria: { true: 'timing is critical' },
  },
} satisfies Record<string, Experimental_EvaluationModelV4Question>;

/** Sum every probability in one answer distribution. */
function distributionSum(probabilities: Record<string, number>): number {
  return Object.values(probabilities).reduce((total, probability) => total + probability, 0);
}

describe('evaluation questions', () => {
  describe('questionsToSchema', () => {
    it('should validate one distribution entry per question type', () => {
      const schema = questionsToSchema(questions);
      const parsed = schema.parse({
        intent: { probabilities: { deal: 0.5, threat: 0.2, talk: 0.3 } },
        shift: { probabilities: [0.2, 0.3, 0.5] },
        urgent: { probability: 0.9 },
      });
      expect(parsed).toEqual({
        intent: { probabilities: { deal: 0.5, threat: 0.2, talk: 0.3 } },
        shift: { probabilities: [0.2, 0.3, 0.5] },
        urgent: { probability: 0.9 },
      });
    });

    it('should default missing choice options to zero', () => {
      const parsed = questionsToSchema(questions).parse({
        intent: { probabilities: { deal: 1 } },
        shift: { probabilities: [0, 0, 0] },
        urgent: { probability: 0 },
      });
      expect(parsed.intent.probabilities).toEqual({ deal: 1, threat: 0, talk: 0 });
    });

    it('should reject out-of-range probabilities and wrong level counts', () => {
      const schema = questionsToSchema(questions);
      expect(() => schema.parse({
        intent: { probabilities: { deal: 1.5, threat: 0, talk: 0 } },
        shift: { probabilities: [0, 0, 0] },
        urgent: { probability: 0 },
      })).toThrow();
      expect(() => schema.parse({
        intent: { probabilities: { deal: 1, threat: 0, talk: 0 } },
        shift: { probabilities: [0.5, 0.5] },
        urgent: { probability: 0 },
      })).toThrow();
    });

    it('should strip options the question never declared', () => {
      const parsed = questionsToSchema(questions).parse({
        intent: { probabilities: { deal: 1, threat: 0, talk: 0, surprise: 0.4 } },
        shift: { probabilities: [0, 0, 0] },
        urgent: { probability: 0 },
      });
      expect(parsed.intent.probabilities).not.toHaveProperty('surprise');
    });
  });

  describe('buildEvaluatorPrompt', () => {
    it('should name every question id, type, instruction, and criterion', () => {
      const prompt = buildEvaluatorPrompt({ board: 'one banner left' }, questions);
      for (const expected of [
        'intent', 'shift', 'urgent',
        'What is the intent of this message?',
        'deal', 'a deal offer', 'threat', 'an explicit threat', 'talk',
        'How large is the strategic shift?',
        'no change', 'minor change', 'major change',
        'Does this need a decision right now?', 'timing is critical',
      ]) {
        expect(prompt).toContain(expected);
      }
    });

    it('should embed object states as JSON and pass string states through', () => {
      expect(buildEvaluatorPrompt({ board: 'text' }, questions)).toContain('"board"');
      const textPrompt = buildEvaluatorPrompt('the plain situation', questions);
      expect(textPrompt).toContain('the plain situation');
      expect(textPrompt).not.toContain('"the plain situation"');
    });
  });

  describe('normalizeAnswers', () => {
    it('should renormalize distributions to sum to one', () => {
      const answers = normalizeAnswers(questions, {
        intent: { probabilities: { deal: 0.4, threat: 0.2, talk: 0.2 } },
        shift: { probabilities: [0.3, 0.3, 0.3] },
        urgent: { probability: 0.25 },
      });
      expect(answers.intent).toMatchObject({ type: 'choice', choice: 'deal' });
      expect(answers.intent.probabilities).toEqual({ deal: 0.5, threat: 0.25, talk: 0.25 });
      expect(distributionSum(answers.intent.probabilities!)).toBe(1);
      expect(distributionSum(answers.shift.probabilities!)).toBeCloseTo(1, 10);
      expect(Object.keys(answers.shift.probabilities!)).toEqual(['0', '1', '2']);
    });

    it('should select the argmax with a first-in-criteria-order tie-break', () => {
      const winner = normalizeAnswers(questions, {
        intent: { probabilities: { deal: 0.2, threat: 0.3, talk: 0.5 } },
      }).intent;
      expect(winner).toMatchObject({ type: 'choice', choice: 'talk' });

      const tied = normalizeAnswers(questions, {
        intent: { probabilities: { deal: 0.35, threat: 0.35, talk: 0.3 } },
      }).intent;
      expect(tied).toMatchObject({ type: 'choice', choice: 'deal' });
    });

    it('should include every option, missing keys at zero, and clamp out-of-range values', () => {
      const answers = normalizeAnswers(questions, {
        intent: { probabilities: { deal: 5, talk: -2 } },
      }).intent;
      // Out-of-range values clamp to [0, 1] first, then the distribution renormalizes.
      expect(answers).toMatchObject({ type: 'choice', choice: 'deal' });
      expect(answers.probabilities).toEqual({ deal: 1, threat: 0, talk: 0 });
    });

    it('should compute the probability-weighted mean for scores', () => {
      const score = normalizeAnswers(questions, {
        shift: { probabilities: [0.5, 0, 0.5] },
      }).shift;
      expect(score).toMatchObject({ type: 'score', score: 1 });
      expect(score.probabilities).toEqual({ '0': 0.5, '1': 0, '2': 0.5 });

      // [0.2, 0, 0.8] sums to 1, so normalization keeps it and the mean is 0*0.2 + 1*0 + 2*0.8.
      const skewed = normalizeAnswers(questions, { shift: { probabilities: [0.2, 0, 0.8] } }).shift;
      expect(skewed.score).toBeCloseTo(1.6);
    });

    it('should fall back to a uniform distribution when every weight is zero', () => {
      const choice = normalizeAnswers(questions, {
        intent: { probabilities: { deal: 0, threat: 0, talk: 0 } },
      }).intent;
      expect(choice.probabilities).toEqual({ deal: 1 / 3, threat: 1 / 3, talk: 1 / 3 });
      expect(choice).toMatchObject({ choice: 'deal' });

      const score = normalizeAnswers(questions, { shift: { probabilities: [] } }).shift;
      expect(score.probabilities).toEqual({ '0': 1 / 3, '1': 1 / 3, '2': 1 / 3 });
      expect(score.score).toBeCloseTo(1);
    });

    it('should clamp boolean probabilities and stay neutral when one is missing', () => {
      expect(normalizeAnswers(questions, { urgent: { probability: 1.4 } }).urgent)
        .toEqual({ type: 'boolean', probability: 1 });
      expect(normalizeAnswers(questions, {}).urgent)
        .toEqual({ type: 'boolean', probability: 0.5 });
    });
  });

  describe('coerceEvaluationInput', () => {
    it('should pass strings through and JSON round-trip everything else', () => {
      expect(coerceEvaluationInput('plain')).toBe('plain');
      expect(coerceEvaluationInput({ a: 1, b: [2] })).toEqual({ a: 1, b: [2] });
      const circular: Record<string, unknown> = { name: 'loop' };
      circular.self = circular;
      expect(typeof coerceEvaluationInput(circular)).toBe('string');
      expect(coerceEvaluationInput(42)).toBe('42');
    });
  });

  describe('experimental_evaluate end to end', () => {
    it('should accept a stub model returning normalized answers', async () => {
      // Weights are in [0, 1] but deliberately do not sum to 1, so normalization is exercised.
      const raw = {
        intent: { probabilities: { deal: 0.6, threat: 0.2, talk: 0 } },
        shift: { probabilities: [0.2, 0.4, 0.4] },
        urgent: { probability: 0.8 },
      };
      const model: Experimental_EvaluationModelV4 = {
        specificationVersion: 'v4',
        provider: 'stub',
        modelId: 'stub-eval',
        supportedQuestionTypes: ['choice', 'score', 'boolean'],
        doEvaluate: async ({ questions: asked }) => ({
          answers: normalizeAnswers(asked, raw),
          usage: { inputTokens: 11, outputTokens: 7 },
          warnings: [],
        }),
      };

      const result = await experimental_evaluate({ model, state: { situation: 'steady' }, questions });

      expect(result.answers.intent).toMatchObject({
        type: 'choice',
        choice: 'deal',
        probabilities: { deal: 0.75, threat: 0.25, talk: 0 },
      });
      expect(result.answers.shift.score).toBeCloseTo(1.2);
      expect(result.answers.urgent.probability).toBe(0.8);
      expect(result.usage).toMatchObject({ inputTokens: 11, outputTokens: 7, totalTokens: 18 });
    });
  });
});
