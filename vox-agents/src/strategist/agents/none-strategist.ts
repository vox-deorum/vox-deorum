/**
 * @module strategist/none-strategist
 *
 * No-op strategist agent implementation.
 * Used for testing or running games without LLM-based decision making.
 */

import { Strategist } from "../strategist.js";
import { VoxContext } from "../../infra/vox-context.js";
import { StrategistParameters } from "../strategy-parameters.js";

/**
 * A do-nothing strategist agent that fetches game state but takes no actions.
 * Used as a baseline for performance comparison or testing infrastructure.
 *
 * @class
 */
export class NoneStrategist extends Strategist {
  /**
   * The name identifier for this agent
   */
  readonly name = "none-strategist";

  readonly displayName = "Vox Populi AI";

  /**
   * Human-readable description of what this agent does
   */
  readonly description = "No-op agent that fetches game state but takes no strategic actions, used for testing or baseline comparisons";
  
  /**
   * Gets the system prompt for the strategist
   */
  public async getSystem(_parameters: StrategistParameters, context: VoxContext<StrategistParameters>): Promise<string> {
    return "";
  }
}