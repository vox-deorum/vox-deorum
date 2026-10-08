/**
 * @module utils/models/evaluation-record
 *
 * Label an evaluation for display: join the questions, answers, and confidence an evaluate span
 * records (`evaluate.questions`, `evaluate.answers`, `evaluate.confidence`) into one labeled entry
 * per question. Pure and free of runtime imports, so the telemetry UI can share it.
 */

import type { LabeledAnswer, LabeledProbability } from "../../types/evaluation.js";

/** A question as an evaluate span records it, loose enough for parsed telemetry. */
export interface RecordedQuestion {
  type: string;
  instructions?: unknown;
  criteria?: unknown;
}

/** An answer as an evaluate span records it, loose enough for parsed telemetry. */
export interface RecordedAnswer {
  choice?: string;
  score?: number;
  probability?: number;
  probabilities?: Record<string, number>;
}

/** Render a criterion or instruction as display text. */
function displayText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Label one score answer: each level's criterion text with its probability, in level order. */
function scoreProbabilities(criteria: unknown, answer: RecordedAnswer | undefined): LabeledProbability[] {
  const levels = Array.isArray(criteria) ? criteria : [];
  return levels.map((criterion, index) => ({
    option: displayText(criterion),
    probability: answer?.probabilities?.[String(index)] ?? 0,
  }));
}

/** Label one choice answer: its options by descending probability, without zero-probability options. */
function choiceProbabilities(answer: RecordedAnswer | undefined): LabeledProbability[] {
  return Object.entries(answer?.probabilities ?? {})
    .filter(([, probability]) => probability > 0)
    .map(([option, probability]) => ({ option, probability }))
    .sort((a, b) => b.probability - a.probability);
}

/**
 * Label every question of an evaluation, in question order. Questions of an unknown type are
 * treated as boolean, and a question without an answer is marked unanswered.
 *
 * @param questions - The question map, as recorded in `evaluate.questions`
 * @param answers - The answers by question id, as recorded in `evaluate.answers`
 * @param confidence - Confidence by question id, as recorded in `evaluate.confidence`, if any
 * @returns One labeled entry per question
 */
export function labelEvaluation(
  questions: Record<string, RecordedQuestion>,
  answers: Record<string, RecordedAnswer | undefined>,
  confidence: Record<string, number> = {},
): LabeledAnswer[] {
  return Object.entries(questions).map(([id, question]) => {
    const answer = answers[id];
    const type = question.type === "choice" || question.type === "score" ? question.type : "boolean";
    const entry: LabeledAnswer = {
      id,
      type,
      ...(question.instructions === undefined ? {} : { instructions: displayText(question.instructions) }),
      answered: answer !== undefined,
      probabilities: type === "score" ? scoreProbabilities(question.criteria, answer)
        : type === "choice" ? choiceProbabilities(answer) : [],
      ...(confidence[id] === undefined ? {} : { confidence: confidence[id] }),
    };
    if (type === "choice" && answer?.choice !== undefined) entry.choice = answer.choice;
    if (type === "score" && answer?.score !== undefined) entry.score = answer.score;
    if (type === "boolean" && answer?.probability !== undefined) entry.probability = answer.probability;
    return entry;
  });
}
