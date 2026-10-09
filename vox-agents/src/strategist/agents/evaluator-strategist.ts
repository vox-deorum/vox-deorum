/**
 * @module strategist/agents/evaluator-strategist
 *
 * A strategist that plays its seat with one evaluation call per decision: it asks the assigned
 * evaluator (a native evaluation model or a chat model through the adapter) about the whole
 * Flavor-mode action space and issues the action tools that change something directly from the
 * answers, with no prompt loop.
 */

import { trace } from "@opentelemetry/api";
import { Strategist } from "../strategist.js";
import type { VoxContext } from "../../infra/vox-context.js";
import type { PreparedAgentState } from "../../infra/vox-agent.js";
import type { ExecuteTokenOutput } from "../../infra/vox-run.js";
import type { Model, StrategistCall } from "../../types/index.js";
import { inputTokenLimit } from "../../utils/models/models.js";
import { isFailedToolResult } from "../../utils/tools/mcp-tools.js";
import { renderSystemPrompt } from "../../utils/prompts/prompt-files.js";
import { ensureGameState, type StrategistParameters } from "../strategy-parameters.js";
import {
  buildStrategistEvaluationState,
  buildStrategistQuestions,
  strategistActionsFromAnswers,
  type StrategistAnswer,
} from "./evaluator-questions.js";

/** Strategist driven by a single evaluation call per decision. */
export class EvaluatorStrategist extends Strategist {
  readonly name = "evaluator-strategist";

  readonly displayName = "Evaluation Model Strategist";

  readonly description = "Decides flavors, persona, relationships, research, and policy with one evaluation call per decision";

  /**
   * Gets the game explanation from the `evaluator-strategist` template, without tool-calling
   * instructions, since the evaluator answers questions instead. Being non-empty also lets the
   * evaluation path run and the in-game label name the model.
   */
  public async getSystem(_parameters: StrategistParameters, _input: unknown, context: VoxContext<StrategistParameters>): Promise<string> {
    return renderSystemPrompt(context, 'evaluator-strategist');
  }

  /**
   * Ask the evaluator about the whole action space, then issue the action tools that change
   * something. A failed action is logged and skipped, so one rejected choice does not void the
   * decision. The decision record goes on the agent span as `strategist.decision`, since the
   * evaluate span already holds the raw answers, and any trimming of the state as `strategist.trim`.
   */
  public override async executeEvaluation(
    parameters: StrategistParameters,
    _input: unknown,
    context: VoxContext<StrategistParameters>,
    prepared: PreparedAgentState,
    model: Model,
    tokenOutput?: ExecuteTokenOutput,
  ): Promise<undefined> {
    if (parameters.mode !== "Flavor") {
      throw new Error(`${this.name} supports only the Flavor decision mode, but the seat uses ${parameters.mode}.`);
    }

    const state = await ensureGameState(context, parameters);
    const { text, trim } = buildStrategistEvaluationState(prepared.system, parameters, state, inputTokenLimit(model));
    // Recorded before the call, so a state that still overflows shows what was already cut.
    if (trim) trace.getActiveSpan()?.setAttribute("strategist.trim", JSON.stringify(trim));
    const set = buildStrategistQuestions(state, parameters.playerID, context.mcpToolMap);
    const { answers } = await context.evaluate(model, text, { questions: set.questions, tokenOutput });
    const { actions, decision } = strategistActionsFromAnswers(answers as Record<string, StrategistAnswer>, set, parameters);

    const calls: StrategistCall[] = [];
    for (const action of actions) {
      context.currentSignal().throwIfAborted();
      const result = await context.callTool(action.name, action.args, parameters);
      const failed = isFailedToolResult(result);
      if (failed) {
        context.logger.warn(`${this.name} action ${action.name} failed; skipping it.`, { PlayerID: parameters.playerID, Turn: parameters.turn });
      }
      const target = action.args.TargetID;
      calls.push({ tool: action.name, status: failed ? "failed" : "applied", ...(typeof target === "number" ? { target } : {}) });
    }
    decision.calls = [...calls, ...decision.calls];
    trace.getActiveSpan()?.setAttribute("strategist.decision", JSON.stringify(decision));
    return undefined;
  }
}
