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
import { renderSystemPrompt } from "../../utils/prompts/prompt-files.js";
import { isContextLengthError } from "../../utils/retry.js";
import { evaluateStrategistState } from "../agents/evaluator-questions.js";
import { withEventWindowFallback, type GameState, type StrategistParameters } from "../strategy-parameters.js";
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
 * what the evaluator strategist sees, with the events since the last decision, trimmed the same
 * way: the trim ladder in {@link evaluateStrategistState}, then fewer events through
 * `withEventWindowFallback` if it still overflows. Returns undefined when triage is off for the
 * strategist, no evaluator is configured, or the evaluation fails (including a state that never
 * fits), so pacing falls back to its cadence. Cancellation still propagates.
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
    const system = renderSystemPrompt(context, "strategist-triage");
    // A copy, since the event window fallback rewrites `mergedEvents` on every attempt.
    const window: GameState = { ...state };
    let verdict: TriageVerdict | undefined;
    const fitted = await withEventWindowFallback(parameters, window, eventFromTurn, async () => {
      try {
        const { answers } = await evaluateStrategistState(
          context, evaluator, system, parameters, window, { questions: triageQuestions, purpose: "triage" },
        );
        const level = Math.min(Math.max(Math.round(answers.revision.score), 0), revisionVerdicts.length - 1);
        verdict = revisionVerdicts[level];
        return true;
      } catch (error) {
        if (isContextLengthError(error)) return false;
        throw error;
      }
    });
    if (!fitted) throw new Error("The state exceeds the evaluator's input limit even with the fewest events.");
    return verdict;
  } catch (error) {
    context.currentSignal().throwIfAborted();
    context.logger.warn(`Strategist triage failed on turn ${parameters.turn}; pacing falls back to its cadence.`, {
      PlayerID: parameters.playerID,
      Error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
