/** Shared evaluator-backed triage hook for agents that opt into tier selection. */

import type {
  Experimental_EvaluationQuestion as EvaluationQuestion,
  Experimental_EvaluationResult as EvaluationResult,
} from 'ai';
import type { Model } from '../types/index.js';
import type { ModelSize } from '../utils/models/models.js';
import { getEvaluatorConfig } from '../utils/models/evaluation.js';
import { triageEnabled } from '../utils/models/resolution.js';
import type { AgentParameters, TriageDecision, VoxAgent } from './vox-agent.js';
import type { VoxContext } from './vox-context.js';

/**
 * Returned by a state builder to decide a deterministic case, such as a greeting, without an
 * evaluator call.
 */
export class TriageShortcut {
  /** @param decision - The decision to use in place of an evaluation */
  constructor(public readonly decision: TriageDecision) {}
}

/**
 * Evaluation state accepted by {@link createTriage}. A string is an instruction paired with the
 * agent's whole input, so it suits agents with small inputs. A builder returns bounded structured
 * state, or a {@link TriageShortcut}.
 */
export type TriageState<TParameters extends AgentParameters, TInput> = string | ((
  parameters: TParameters,
  input: TInput,
  context: VoxContext<TParameters>,
) => unknown);

/** Custom questions and answer router for an agent-specific triage policy. */
export interface TriageConfiguration<TQuestions extends Record<string, EvaluationQuestion>> {
  questions: TQuestions;
  route: (answers: EvaluationResult<TQuestions>['answers']) => TriageDecision;
}

/** The default question lets an evaluator select the execution tier directly. */
const defaultTriageQuestions = {
  tier: {
    type: 'choice',
    instructions: 'Which model tier should handle this situation?',
    criteria: {
      small: 'Routine, simple, or low stakes work',
      default: 'Normal work that needs standard judgment',
      large: 'Complex, ambiguous, or high stakes work',
    },
  },
} satisfies Record<string, EvaluationQuestion>;

/** The default policy routes the chosen tier straight into the decision. */
const defaultTriage: TriageConfiguration<typeof defaultTriageQuestions> = {
  questions: defaultTriageQuestions,
  route: answers => ({ tier: answers.tier.choice as ModelSize }),
};

/** Evaluate the state against one policy and keep the answers on the decision for diagnostics. */
async function evaluateTriage<TParameters extends AgentParameters, TQuestions extends Record<string, EvaluationQuestion>>(
  context: VoxContext<TParameters>,
  evaluator: Model,
  state: unknown,
  { questions, route }: TriageConfiguration<TQuestions>,
): Promise<TriageDecision> {
  const result = await context.evaluate(evaluator, state, { questions });
  const decision = route(result.answers);
  return { ...decision, answers: decision.answers ?? result.answers };
}

/**
 * Build a VoxAgent-compatible triage hook from evaluation state or a state builder.
 *
 * The hook first checks the agent's own assignment and evaluator reference, so disabled triage
 * does no state-building work. Without a configuration, the evaluator picks the tier directly.
 */
export function createTriage<
  TParameters extends AgentParameters,
  TInput,
  TQuestions extends Record<string, EvaluationQuestion>,
>(
  state: TriageState<TParameters, TInput>,
  configuration?: TriageConfiguration<TQuestions>,
): NonNullable<VoxAgent<TParameters, TInput>['triage']> {
  return async function triageHook(
    this: VoxAgent<TParameters, TInput>,
    parameters: TParameters,
    input: TInput,
    context: VoxContext<TParameters>,
  ): Promise<TriageDecision | undefined> {
    if (!triageEnabled(this.name, context.modelOverrides)) return undefined;
    const evaluator = getEvaluatorConfig(this.name, context.modelOverrides);
    if (!evaluator) return undefined;

    const built = typeof state === 'function'
      ? await state(parameters, input, context)
      : { instructions: state, input };
    if (built instanceof TriageShortcut) return built.decision;

    return configuration
      ? evaluateTriage(context, evaluator, built, configuration)
      : evaluateTriage(context, evaluator, built, defaultTriage);
  };
}
