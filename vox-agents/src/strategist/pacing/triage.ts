/**
 * @module strategist/pacing/triage
 *
 * Strategist triage for pacing: one evaluation that rates how much the current strategic decisions
 * need revising, which pacing turns into a skip or a model tier for this turn.
 */

import type { Experimental_EvaluationQuestion as EvaluationQuestion } from "ai";
import type { VoxContext } from "../../infra/vox-context.js";
import { triageEnabled } from "../../infra/triage.js";
import { getEvaluatorConfig } from "../../utils/models/evaluation.js";
import { inputTokenLimit } from "../../utils/models/models.js";
import { renderSystemPrompt } from "../../utils/prompts/prompt-files.js";
import { buildStrategistEvaluationState } from "../agents/evaluator-questions.js";
import { mergeCachedEvents, type GameState, type StrategistParameters } from "../strategy-parameters.js";
import type { TriageVerdict } from "../pacing.js";

/** The single triage question, with one level per verdict in {@link revisionVerdicts}. */
const triageQuestions = {
  revision: {
    type: "score",
    instructions: "How much do your current strategic decisions need to change this turn?",
    criteria: [
      "none: every current decision still fits",
      "tweaks: slight changes that keep the plan, such as the next research or policy",
      "revision: some decisions need rethinking",
      "overhaul: the plan needs a major, complicated revision",
    ],
  },
} satisfies Record<string, EvaluationQuestion>;

/** The verdict for each `revision` level, in order. */
const revisionVerdicts: TriageVerdict[] = ["skip", "small", "default", "large"];

/**
 * Ask the strategist's evaluator how much the current strategic decisions need to change. The evaluator sees
 * what the evaluator strategist sees, with the events since the last decision. Returns undefined
 * when triage is off for the strategist, no evaluator is configured, or the evaluation fails, so
 * pacing falls back to its cadence. Cancellation still propagates.
 *
 * @param context - The seat context, inside the turn's root run
 * @param parameters - The turn's strategist parameters
 * @param state - The turn's game state (never mutated)
 * @param strategist - The seat's strategist agent name
 * @param eventFromTurn - The first turn not yet covered by a decision
 * @returns The triage verdict, or undefined when triage did not run
 */
export async function runStrategistTriage(
  context: VoxContext<StrategistParameters>,
  parameters: StrategistParameters,
  state: GameState,
  strategist: string,
  eventFromTurn: number,
): Promise<TriageVerdict | undefined> {
  if (!triageEnabled(strategist, context.triage)) return undefined;
  const evaluator = getEvaluatorConfig(strategist, context.modelOverrides);
  if (!evaluator) return undefined;

  try {
    const window = { ...state, mergedEvents: mergeCachedEvents(parameters, eventFromTurn, parameters.turn) };
    const system = renderSystemPrompt(context, "strategist-triage");
    const { text } = buildStrategistEvaluationState(system, parameters, window, inputTokenLimit(evaluator));
    const { answers } = await context.evaluate(evaluator, text, { questions: triageQuestions, purpose: "triage" });
    const level = Math.min(Math.max(Math.round(answers.revision.score), 0), revisionVerdicts.length - 1);
    return revisionVerdicts[level];
  } catch (error) {
    context.currentSignal().throwIfAborted();
    context.logger.warn(`Strategist triage failed on turn ${parameters.turn}; pacing falls back to its cadence.`, {
      PlayerID: parameters.playerID,
      Error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
