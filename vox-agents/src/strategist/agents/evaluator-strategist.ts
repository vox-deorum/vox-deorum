/**
 * @module strategist/agents/evaluator-strategist
 *
 * A strategist that plays its seat with one evaluation call per decision: it asks the assigned
 * evaluator (a native evaluation model or a chat model through the adapter) about the whole
 * Flavor-mode action space and issues the action tools directly from the answers, with no prompt loop.
 */

import { Strategist } from "../strategist.js";
import type { VoxContext } from "../../infra/vox-context.js";
import type { PreparedAgentState } from "../../infra/vox-agent.js";
import type { ExecuteTokenOutput } from "../../infra/vox-run.js";
import type { Model } from "../../types/index.js";
import { inputTokenLimit } from "../../utils/models/models.js";
import { isFailedToolResult } from "../../utils/tools/mcp-tools.js";
import { ensureGameState, type StrategistParameters } from "../strategy-parameters.js";
import {
  buildStrategistEvaluationState,
  buildStrategistQuestions,
  describeAnswers,
  strategistActionsFromAnswers,
  type StrategistAnswer,
} from "./evaluator-questions.js";

/** Strategist driven by a single evaluation call per decision. */
export class EvaluatorStrategist extends Strategist {
  readonly name = "evaluator-strategist";

  readonly displayName = "Evaluation Model Strategist";

  readonly description = "Decides flavors, persona, relationships, research, and policy with one evaluation call per decision";

  /** A non-empty prompt, so the evaluation path runs and the in-game label names the model. */
  public async getSystem(): Promise<string> {
    return "Evaluate the strategic situation and choose the civilization's direction.";
  }

  /**
   * Ask the evaluator about the whole action space, then issue the chosen action tools.
   * A failed action is logged and skipped, so one rejected choice does not void the decision.
   */
  public override async executeEvaluation(
    parameters: StrategistParameters,
    _input: unknown,
    context: VoxContext<StrategistParameters>,
    _prepared: PreparedAgentState,
    model: Model,
    tokenOutput?: ExecuteTokenOutput,
  ): Promise<string | undefined> {
    if (parameters.mode !== "Flavor") {
      throw new Error(`${this.name} supports only the Flavor decision mode, but the seat uses ${parameters.mode}.`);
    }

    const state = await ensureGameState(context, parameters);
    const evaluationState = buildStrategistEvaluationState(parameters, state, inputTokenLimit(model));
    const set = buildStrategistQuestions(state, parameters.playerID, context.mcpToolMap);
    const { answers } = await context.evaluate(model, evaluationState, { questions: set.questions, tokenOutput });
    const actions = strategistActionsFromAnswers(answers as Record<string, StrategistAnswer>, set, parameters);

    let applied = 0;
    for (const action of actions) {
      context.currentSignal().throwIfAborted();
      const result = await context.callTool(action.name, action.args, parameters);
      if (isFailedToolResult(result)) {
        context.logger.warn(`${this.name} action ${action.name} failed; skipping it.`, { PlayerID: parameters.playerID, Turn: parameters.turn });
        continue;
      }
      applied++;
    }
    const summary = `Applied ${applied} of ${actions.length} actions: ${actions.map(action => action.name).join(", ")}.`;
    return `${summary}\n${describeAnswers(answers as Record<string, StrategistAnswer>, set)}`;
  }
}
