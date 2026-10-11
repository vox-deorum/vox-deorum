/**
 * @module briefer/briefer
 *
 * Base briefer agent implementation. All briefers inherit from this class.
 */

import { StepResult, Tool } from "ai";
import { VoxAgent } from "../infra/vox-agent.js";
import type { VoxContext } from "../infra/vox-context.js";
import { StrategistParameters } from "../strategist/strategy-parameters.js";
import { bashToolName } from "../utils/tools/tool-names.js";

/**
 * Base briefer agent that summarizes the game state.
 *
 * @abstract
 * @class
 */
export abstract class Briefer<TInput = string> extends VoxAgent<StrategistParameters, TInput, string> {
  /** Briefers summarize state using the routine model. */
  public modelSize = 'small' as const;

  /**
   * Stops once a step without bash produced the briefing text, or at the step limit. Text next to a
   * bash call is the model working in the workspace ("checking notes"), not the briefing.
   */
  public stopCheck(
    _parameters: StrategistParameters,
    _input: unknown,
    _lastStep: StepResult<Record<string, Tool>>,
    allSteps: StepResult<Record<string, Tool>>[],
    context: VoxContext<StrategistParameters>
  ): boolean {
    for (const step of allSteps) {
      if (step.toolCalls.some((call) => call.toolName === bashToolName)) continue;
      for (const result of step.content) {
        if (result.type === "text" && result.text.length >= 10) {
          this.logger.info(`Briefing produced (length ${result.text.length}), stopping agent`, {
            Abstract: result.text.substring(0, 500).replace("\n\n", "\n") + "..."
          });
          return true;
        }
      }
    }

    return this.reachedStepLimit(allSteps, context);
  }
}
