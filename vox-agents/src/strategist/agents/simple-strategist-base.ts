/**
 * @module strategist/simple-strategist-base
 *
 * Base class for simple strategist agent implementations.
 * Provides common functionality for high-level strategic decision-making in Civilization V.
 */

import { Strategist } from "../strategist.js";
import { ModelMessage } from "ai";
import { VoxContext } from "../../infra/vox-context.js";
import { getDecisionTurnContext, getRecentGameState, StrategistParameters } from "../strategy-parameters.js";
import { fileMode, insertRecordsDirections } from "../../knowledge/directions.js";
import { renderSection, strategistInlineSections } from "../../knowledge/sections.js";
import { getStrategicPlayersReport } from "../../utils/prompts/report-filters.js";
import { cacheBreakpoint } from "../../utils/models/cache-breakpoint.js";

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

  /** Assemble the shared system and report messages after a subclass prepares briefing text. */
  protected buildBriefingMessages(
    parameters: StrategistParameters,
    state: NonNullable<ReturnType<typeof getRecentGameState>>,
    context: VoxContext<StrategistParameters>,
    briefingsContent: string,
    additionalReports = ""
  ): ModelMessage[] {
    const { YouAre, ...SituationData } = parameters.metadata || {};
    const { Options, ...Strategy } = state.options || {};
    let reportsContent = `
${renderSection("strategies", Strategy)}

${renderSection("players", getStrategicPlayersReport(state.players!))}

${renderSection("victory", state.victory)}

${renderSection("briefings", briefingsContent, { rendered: true })}

${getDecisionTurnContext(parameters, fileMode(context))}
`.trim();
    if (additionalReports) {
      reportsContent += `\n\n${additionalReports}`;
    }

    const messages: ModelMessage[] = [{
      role: "system",
      content: `
You are ${parameters.metadata?.YouAre!.Leader}, leader of ${parameters.metadata?.YouAre!.Name} (Player ${parameters.playerID ?? 0}).

${renderSection("situation", SituationData)}

${renderSection("civilization", YouAre)}

${renderSection("options", Options)}`.trim(),
      providerOptions: { ...cacheBreakpoint }
    }, {
      role: "user",
      content: reportsContent
    }];
    insertRecordsDirections(messages, context, strategistInlineSections);
    return messages;
  }

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
