/**
 * @module utils/models/evaluation-questions
 *
 * Pure helpers that recast typed evaluation questions for a chat model: a zod
 * schema for the probability distributions, one prompt that states the shared
 * state and names every criterion, and a normalizer that turns a raw reply
 * into strict provider answers. No provider or SDK-model imports: only zod and
 * the AI SDK question and answer types, so the helpers stay testable without mocks.
 */

import { z } from 'zod';
import type {
  Experimental_EvaluationModelV4Answer as EvaluationModelV4Answer,
  Experimental_EvaluationModelV4Input as EvaluationModelV4Input,
  Experimental_EvaluationModelV4Question as EvaluationModelV4Question,
} from '@ai-sdk/provider';

/** A question map keyed by question id, exactly as `experimental_evaluate` accepts it. */
export type EvaluationQuestionMap = Readonly<Record<string, EvaluationModelV4Question>>;

/** Renders one question or criterion input as readable prompt text. */
function describeInput(value: EvaluationModelV4Input | null | undefined): string {
  if (value === null || value === undefined) return 'no description';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Build the zod schema the chat evaluator validates its reply against: one
 * entry per question id carrying its full distribution. Choice entries hold
 * every option key (an absent option defaults to 0), score entries hold one
 * number per level in order, boolean entries hold a single P(true).
 *
 * @param questions - The question map being evaluated
 * @returns A zod object schema keyed by question id
 */
export function questionsToSchema(questions: EvaluationQuestionMap) {
  const shape: Record<string, z.ZodType> = {};
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === 'choice') {
      shape[id] = z.object({
        probabilities: z.object(Object.fromEntries(
          Object.keys(question.criteria).map((option) => [option, z.number().min(0).max(1).default(0)]),
        )),
      });
    } else if (question.type === 'score') {
      shape[id] = z.object({
        probabilities: z.array(z.number().min(0).max(1)).length(question.criteria.length),
      });
    } else {
      shape[id] = z.object({ probability: z.number().min(0).max(1) });
    }
  }
  return z.object(shape);
}

/**
 * Build the single user prompt for one evaluation call. It instructs the model
 * to answer every question about the shared state with a full probability
 * distribution, embeds the state (strings pass through, anything else is
 * JSON-rendered), then lists every question id, type, and instruction and
 * names every option, level, or boolean description.
 *
 * @param state - The shared evaluation state
 * @param questions - The question map being evaluated
 * @returns One prompt string
 */
export function buildEvaluatorPrompt(state: unknown, questions: EvaluationQuestionMap): string {
  const lines: string[] = [
    'You are an evaluation model. Answer every question below about the shared state with a complete probability distribution.',
    'Report the probability of every option or level as a number in [0, 1], and make each question\'s probabilities sum to 1.',
    'Reply with a single JSON object keyed by question id: a choice question takes {"probabilities": {"<option>": <number>, ...}} covering every option,',
    'a score question takes {"probabilities": [<number>, ...]} with one number per level in order,',
    'and a boolean question takes {"probability": <P(true)>}.',
    '',
    '## State',
    typeof state === 'string' ? state : JSON.stringify(state, null, 2),
    '',
    '## Questions',
  ];
  for (const [id, question] of Object.entries(questions)) {
    lines.push(`- id "${id}" (type: ${question.type}): ${describeInput(question.instructions)}`);
    if (question.type === 'choice') {
      for (const [option, criterion] of Object.entries(question.criteria)) {
        lines.push(`    option "${option}": ${describeInput(criterion)}`);
      }
    } else if (question.type === 'score') {
      question.criteria.forEach((criterion, index) => {
        lines.push(`    level ${index}: ${describeInput(criterion)}`);
      });
    } else if (question.criteria) {
      lines.push(`    true: ${describeInput(question.criteria.true ?? null)}`);
      lines.push(`    false: ${describeInput(question.criteria.false ?? null)}`);
    }
  }
  return lines.join('\n');
}

/** Clamp one raw value into a probability in [0, 1]; junk counts as 0. */
function clampProbability(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(1, Math.max(0, numeric));
}

/**
 * Rescale weights into an exact-summing distribution: all-zero (or junk)
 * weights fall back to uniform, and the floating-point residual of the sum is
 * folded into the first maximal weight so it stays the maximum.
 */
function normalizeWeights(weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return weights.map(() => 1 / weights.length);
  const normalized = weights.map((weight) => weight / total);
  let maxIndex = 0;
  normalized.forEach((weight, index) => {
    if (weight > normalized[maxIndex]) maxIndex = index;
  });
  normalized[maxIndex] += 1 - normalized.reduce((sum, weight) => sum + weight, 0);
  return normalized;
}

/**
 * Convert a raw per-question reply (the schema shape, or anything looser from
 * a lenient parse) into strict provider answers that pass `experimental_evaluate`:
 * every declared option or level is included, values are clamped to [0, 1] and
 * renormalized to sum to 1, the choice is the argmax with a deterministic
 * first-in-criteria-order tie-break, and the score is the probability-weighted
 * mean of the level indices keyed '0' through 'N-1'. A boolean with a missing
 * or junk probability stays neutral at P(true) = 0.5.
 *
 * @param questions - The question map the reply answers
 * @param parsed - The raw reply object keyed by question id
 * @returns One strict answer record per question id
 */
export function normalizeAnswers(
  questions: EvaluationQuestionMap,
  parsed: unknown,
): Record<string, EvaluationModelV4Answer> {
  const root = (parsed ?? {}) as Record<string, { probabilities?: unknown; probability?: unknown } | undefined>;
  const answers: Record<string, EvaluationModelV4Answer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const reply = root[id];
    if (question.type === 'choice') {
      const options = Object.keys(question.criteria);
      const raw = (reply?.probabilities ?? {}) as Record<string, unknown>;
      const weights = normalizeWeights(options.map((option) => clampProbability(raw[option])));
      let best = 0;
      weights.forEach((weight, index) => {
        if (weight > weights[best]) best = index;
      });
      answers[id] = {
        type: 'choice',
        choice: options[best],
        probabilities: Object.fromEntries(options.map((option, index) => [option, weights[index]])),
      };
    } else if (question.type === 'score') {
      const raw = Array.isArray(reply?.probabilities) ? reply.probabilities : [];
      const weights = normalizeWeights(question.criteria.map((_, index) => clampProbability(raw[index])));
      answers[id] = {
        type: 'score',
        score: weights.reduce((mean, weight, index) => mean + index * weight, 0),
        probabilities: Object.fromEntries(weights.map((weight, index) => [String(index), weight])),
      };
    } else {
      const probability = reply?.probability;
      answers[id] = {
        type: 'boolean',
        probability: probability === undefined || probability === null || !Number.isFinite(Number(probability))
          ? 0.5
          : clampProbability(probability),
      };
    }
  }
  return answers;
}

/**
 * Coerce an arbitrary evaluation state into the JSON input the provider
 * contract accepts: strings pass through, everything else round-trips through
 * JSON so class instances normalize to plain data, and an unserializable or
 * scalar-only value degrades to its string form.
 *
 * @param state - The state the caller wants evaluated
 * @returns A valid EvaluationModelV4Input
 */
export function coerceEvaluationInput(state: unknown): EvaluationModelV4Input {
  if (typeof state === 'string') return state;
  try {
    const roundTripped = JSON.parse(JSON.stringify(state));
    if (typeof roundTripped === 'string' || (typeof roundTripped === 'object' && roundTripped !== null)) {
      return roundTripped as EvaluationModelV4Input;
    }
  } catch {
    // Fall through: the string form is always a valid input.
  }
  return String(state);
}
