/**
 * @module envoy/spokesperson
 *
 * Spokesperson envoy agent that represents the current civilization and answers questions diplomatically.
 * Provides diplomatic responses based on the civilization's current state and relationships.
 */

import { LiveEnvoy } from "../live-envoy.js";
import { VoxContext } from "../../infra/vox-context.js";
import { StrategistParameters } from "../../strategist/strategy-parameters.js";
import { EnvoyThread } from "../../types/index.js";
import { renderSystemPrompt } from "../../utils/prompts/prompt-files.js";
import { getTeammateCounterpart } from "../context/diplomacy-context.js";

/**
 * Spokesperson agent that represents the civilization diplomatically.
 * Responds to questions about the civilization's status, relationships, and intentions
 * with appropriate diplomatic framing based on the current game state.
 *
 * @class
 */
export class Spokesperson extends LiveEnvoy {
  /** The spokesperson recites known status using the routine model. */
  public modelSize = 'small' as const;

  /**
   * The name identifier for this agent
   */
  readonly name = "spokesperson";

  /**
   * Human-readable description of what this agent does
   */
  readonly description = "A spokesperson who answers questions about the civilization's status, relationships, and intentions with appropriate diplomatic tact";

  /**
   * Tags for categorizing this agent
   */
  public tags = ["active-game", "diplomatic"];

  /**
   * Extends LiveEnvoy's tool set (get-briefing + send-message) with the MCP get-diplomatic-events tool
   */
  public override getActiveTools(_parameters: StrategistParameters): string[] | undefined {
    return ["get-briefing", "send-message", "get-diplomatic-events"];
  }

  /**
   * Gets the system prompt defining the spokesperson persona
   */
  public async getSystem(
    parameters: StrategistParameters,
    input: EnvoyThread,
    context: VoxContext<StrategistParameters>
  ): Promise<string> {
    return renderSystemPrompt(context, 'spokesperson', {
      user: this.formatUserDescription(input),
      teammate: getTeammateCounterpart(parameters, input),
    });
  }

  /**
   * The spokesperson's normal-mode nudge appended after the hint: every response reflects
   * on the leader's standing.
   */
  protected override getDefaultAddon(): string {
    return "Every response reflects on our leader's leadership and your civilization's standing.";
  }
  
  /** Spokesperson run at the default reasoning tier. */
  protected reasoningTier = "default" as const;
}
