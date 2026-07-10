/**
 * @module briefer/briefer
 *
 * Base briefer agent implementation. All briefers inherit from this class.
 */

import { StepResult, Tool } from "ai";
import { VoxAgent } from "../infra/vox-agent.js";
import { StrategistParameters } from "../strategist/strategy-parameters.js";

/**
 * Base briefer agent that summarizes the game state.
 *
 * @abstract
 * @class
 */
export abstract class Briefer<TInput = string> extends VoxAgent<StrategistParameters, TInput, string> {
  /**
   * Post-processes the output before returning it.
   * Override this method to modify the output after getOutput.
   *
   * @param output - The output from getOutput
   * @returns The post-processed output
   */
  public postprocessOutput(
    parameters: StrategistParameters,
    _input: TInput,
    output: string
  ): string {
    parameters.gameStates[parameters.turn].reports["briefing"] = output;
    return output;
  }

  /**
   * Determines whether the agent should stop execution
   */
  public stopCheck(
    _parameters: StrategistParameters,
    _input: unknown,
    _lastStep: StepResult<Record<string, Tool>>,
    allSteps: StepResult<Record<string, Tool>>[]
  ): boolean {
    // Stop if we've executed set-strategy tool
    for (var step of allSteps) {
      for (const result of step.content) {
        if (result.type === "text" && result.text.length >= 10) {
          this.logger.info(`Briefing produced (length ${result.text.length}), stopping agent`, {
            Abstract: result.text.substring(0, 500).replace("\n\n", "\n") + "..."
          });
          return true;
        }
      }
    }

    // Also stop after 3 steps to prevent infinite loops
    if (allSteps.length >= 3) {
      this.logger.warn("Reached maximum step limit (3), stopping agent");
      return true;
    }

    return false;
  }
}