/**
 * @module strategist/simple-strategist
 *
 * Simple strategist agent implementation.
 * Provides high-level strategic decision-making for Civilization V gameplay,
 * including diplomatic persona, technology research, policy adoption, and grand strategy selection.
 */

import { ModelMessage } from "ai";
import { SimpleStrategistBase } from "./simple-strategist-base.js";
import { VoxContext } from "../../infra/vox-context.js";
import { getRecentGameState, renderStrategistReports, StrategistParameters } from "../strategy-parameters.js";
import { SimpleBriefer } from "../../briefer/simple-briefer.js";
import { cacheBreakpoint } from "../../utils/models/cache-breakpoint.js";

/**
 * A simple strategist agent that analyzes the game state and sets an appropriate strategy.
 * Makes high-level decisions and delegates tactical execution to the in-game AI.
 *
 * @class
 */
export class SimpleStrategist extends SimpleStrategistBase {
  /**
   * The name identifier for this agent
   */
  readonly name = "simple-strategist";

  readonly displayName = "Simple LLM Strategist";

  /** Offer this direct strategist style in the game setup wizard. */
  public offeredInSetup = true;

  /**
   * Human-readable description of what this agent does
   */
  readonly description = "Analyzes game state and makes strategic decisions for Civ V gameplay including diplomacy, technology, policy, and grand strategy";
  
  /**
   * Gets the system prompt for the strategist
   */
  public async getSystem(parameters: StrategistParameters, _context: VoxContext<StrategistParameters>): Promise<string> {
    return `
${SimpleStrategistBase.expertPlayerPrompt}

${SimpleStrategistBase.expectationPrompt}

${SimpleStrategistBase.goalsPrompt}
${SimpleStrategistBase.getDecisionPrompt(parameters.mode)}

# Resources
You will receive the following reports:
${SimpleStrategistBase.optionsDescriptionPrompt}
${SimpleStrategistBase.strategiesDescriptionPrompt}
${SimpleStrategistBase.victoryConditionsPrompt}
${SimpleStrategistBase.playersInfoPrompt}
${SimpleBriefer.citiesPrompt}
${SimpleBriefer.militaryPrompt}
${SimpleBriefer.eventsPrompt}`.trim()
  }
  
  /**
   * Gets the initial messages for the conversation
   */
  public async getInitialMessages(parameters: StrategistParameters, _input: unknown, _context: VoxContext<StrategistParameters>): Promise<ModelMessage[]> {
    const [overview, reports] = renderStrategistReports(parameters, getRecentGameState(parameters)!);
    return [
      { role: "system", content: overview, providerOptions: { ...cacheBreakpoint } },
      { role: "user", content: reports },
    ];
  }
}
