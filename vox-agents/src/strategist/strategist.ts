/**
 * @module strategist/strategist
 *
 * Base strategist agent implementation. All strategists inherit from this class.
 */

import { ModelMessage, StepResult, Tool } from "ai";
import { VoxAgent } from "../infra/vox-agent.js";
import { StrategistParameters } from "./strategy-parameters.js";
import { VoxContext } from "../infra/vox-context.js";

/**
 * Base strategist agent that analyzes the game state and sets an appropriate strategy.
 *
 * @abstract
 * @class
 */
export abstract class Strategist extends VoxAgent<StrategistParameters> {
  abstract readonly displayName: string;
  /** Strategists run at the default reasoning tier. */
  protected modelTier = "default" as const;
}