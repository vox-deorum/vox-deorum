/**
 * @module strategist/simple-strategist-base
 *
 * Base class for simple strategist agent implementations.
 * Provides common functionality for high-level strategic decision-making in Civilization V.
 */

import { Strategist } from "../strategist.js";
import { StrategistParameters } from "../strategy-parameters.js";

/**
 * Base class for simple strategist agents.
 * Provides common tools and stop condition logic for strategic decision-making.
 * System prompt prose lives in `prompts/simple-strategist*.md` and their shared fragments.
 *
 * @abstract
 * @class
 */
export abstract class SimpleStrategistBase extends Strategist {
  public completionTools = ["set-strategy", "set-flavors", "keep-status-quo"];
  public maxSteps = 5;

  /**
   * Gets the list of active tools for this agent
   */
  public getActiveTools(parameters: StrategistParameters): string[] | undefined {
    // Return specific tools the strategist needs
    return [
      parameters.mode === "Strategy" ? "set-strategy" : "set-flavors",
      "set-persona",
      "set-research",
      "set-policy",
      "set-relationship",
      "keep-status-quo"
    ];
  }

}
