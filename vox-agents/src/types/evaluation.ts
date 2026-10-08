/**
 * @module types/evaluation
 *
 * Telemetry shapes for evaluations: a question's answer labeled for display, and the evaluator
 * strategist's decision record, which compares each answer with the game and lists the calls made.
 */

/** One option of a labeled answer and its probability. */
export interface LabeledProbability {
  /** The choice option, or the score level's criterion text (for example `30: enough`). */
  option: string;
  probability: number;
}

/** One evaluation question with its answer, labeled from the question's criteria. */
export interface LabeledAnswer {
  id: string;
  type: 'choice' | 'score' | 'boolean';
  instructions?: string;
  /** False when the evaluator returned no answer for the question. */
  answered: boolean;
  /** The chosen option of a choice question. */
  choice?: string;
  /** The position between the levels of a score question (for example 2.5). */
  score?: number;
  /** The probability of true for a boolean question. */
  probability?: number;
  /** Score levels in criteria order, or choice options by descending probability without zeros. */
  probabilities: LabeledProbability[];
  /** The evaluator's confidence in the answer, when the provider reports one. */
  confidence?: number;
}

/** How one strategist question compared with the game. */
export interface StrategistQuestionOutcome {
  /** The in-game value before the decision, when the game has one. */
  current?: number | string;
  /** The value a score maps to, or the option a choice picked. */
  proposed?: number | string;
  /** Whether the proposed value was sent to the game. */
  sent: boolean;
}

/** One action tool the strategist called or dropped. */
export interface StrategistCall {
  tool: string;
  /** `dropped` when the answers matched the game, so the call was not made. */
  status: 'applied' | 'failed' | 'dropped';
  /** The target player of a relationship call. */
  target?: number;
}

/** The evaluator strategist's decision, recorded as the `strategist.decision` span attribute. */
export interface StrategistDecision {
  /** The score deadband the strategist used, in scale points. */
  deadband?: number;
  /** Outcomes keyed by question id. */
  questions: Record<string, StrategistQuestionOutcome>;
  /** The calls made, in order, followed by the dropped calls. */
  calls: StrategistCall[];
}
