/** Shared evaluator-backed triage hook for agents that opt into tier selection. */

import type {
  Experimental_EvaluationQuestion as EvaluationQuestion,
  Experimental_EvaluationResult as EvaluationResult,
} from 'ai';
import type { ModelSize } from '../utils/models/models.js';
import { getEvaluatorConfig } from '../utils/models/evaluation.js';
import { triageEnabled } from '../utils/models/resolution.js';
import type { AgentParameters, PreparedAgentState, TriageDecision, VoxAgent } from './vox-agent.js';
import type { VoxContext } from './vox-context.js';

/** Return a deterministic decision before asking evaluator questions. */
export class TriageShortcut {
  /** @param decision - The decision to use in place of an evaluation */
  constructor(public readonly decision: TriageDecision) {}
}

/** Questions and answer router for one agent-specific triage policy. */
interface TriageStateOptions<
  TParameters extends AgentParameters,
  TInput,
> {
  /** Optionally trim or reshape the already prepared prompt for evaluation. */
  projectState?: (
    prepared: PreparedAgentState,
    parameters: TParameters,
    input: TInput,
    context: VoxContext<TParameters>,
  ) => unknown;
  /** Resolve deterministic cases such as greetings without an evaluator call. */
  shortcut?: (
    parameters: TParameters,
    input: TInput,
    context: VoxContext<TParameters>,
  ) => TriageShortcut | undefined;
}

/** Custom questions always carry their matching answer router; omitting both selects the default tier question. */
export type TriageConfiguration<
  TQuestions extends Record<string, EvaluationQuestion>,
  TParameters extends AgentParameters,
  TInput,
> = TriageStateOptions<TParameters, TInput> & (
  | { questions: TQuestions; route: (answers: EvaluationResult<TQuestions>['answers']) => TriageDecision }
  | { questions?: undefined; route?: undefined }
);

/** The default question lets an evaluator select the execution tier directly. */
const defaultTriageQuestions = {
  tier: {
    type: 'choice',
    instructions: 'Choose the model tier suited to the prepared task.',
    criteria: {
      small: 'Routine work with low complexity or stakes',
      default: 'Work that needs standard judgment',
      large: 'Work with high complexity, ambiguity, or stakes',
    } satisfies Record<ModelSize, string>,
  },
} satisfies Record<string, EvaluationQuestion>;

/** Map the default answer to the chosen execution tier. */
const routeDefaultTriage = (answers: EvaluationResult<typeof defaultTriageQuestions>['answers']): TriageDecision => ({
  tier: answers.tier.choice as ModelSize,
});

/**
 * Build a triage hook that reuses the prepared prompt and optionally projects it into a smaller state.
 * The agent's own opt-in and evaluator assignment are checked before any question or projection work.
 */
export function createTriage<
  TParameters extends AgentParameters,
  TInput,
  TQuestions extends Record<string, EvaluationQuestion> = typeof defaultTriageQuestions,
>(
  configuration?: TriageConfiguration<TQuestions, TParameters, TInput>,
): NonNullable<VoxAgent<TParameters, TInput>['triage']> {
  return async function triageHook(
    this: VoxAgent<TParameters, TInput>,
    parameters: TParameters,
    input: TInput,
    context: VoxContext<TParameters>,
    prepared: PreparedAgentState,
  ): Promise<TriageDecision | undefined> {
    if (!triageEnabled(this.name, context.modelOverrides)) return undefined;
    const evaluator = getEvaluatorConfig(this.name, context.modelOverrides);
    if (!evaluator) return undefined;

    const shortcut = configuration?.shortcut?.(parameters, input, context);
    if (shortcut) return shortcut.decision;

    const state = configuration?.projectState
      ? configuration.projectState(prepared, parameters, input, context)
      : prepared;
    const questions = configuration?.questions ?? defaultTriageQuestions;
    const result = await context.evaluate(evaluator, state, { questions });
    const answers = result.answers;
    const decision = configuration?.questions && configuration.route
      ? configuration.route(answers as EvaluationResult<TQuestions>['answers'])
      : routeDefaultTriage(answers as EvaluationResult<typeof defaultTriageQuestions>['answers']);
    return { ...decision, answers: decision.answers ?? answers };
  };
}
