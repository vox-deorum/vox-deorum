/**
 * @module briefer/specialized-briefer
 *
 * Specialized briefer agent that focuses on specific game aspects (Military, Economy, or Diplomacy).
 * Uses mode-specific prompts and filters events/data to provide targeted strategic briefings.
 */

import { ModelMessage, Tool } from "ai";
import { z } from "zod";
import { Briefer } from "./briefer.js";
import { VoxContext } from "../infra/vox-context.js";
import { getRecentGameState, StrategistParameters } from "../strategist/strategy-parameters.js";
import { jsonToMarkdown } from "../utils/tools/json-to-markdown.js";
import { createSimpleTool } from "../utils/tools/simple-tools.js";
import { getOffsetedTurn } from "../utils/prompts/game-speed.js";
import { briefingInstructionKeys, briefingReportKeys, getLastBriefingState } from "./briefing-utils.js";
import { filterEventsByCategory, EventCategory } from "../utils/prompts/event-filters.js";
import { pickPlayerFields, omitPlayerFields, pickCityFields, omitCityFields } from "../utils/prompts/report-filters.js";
import type { ConsolidatedEventsReport } from '../../../mcp-server/dist/tools/knowledge/get-events.js';
import { cacheBreakpoint } from "../utils/models/cache-breakpoint.js";
import { renderSystemPrompt } from "../utils/prompts/prompt-files.js";

/**
 * Mode type for specialized briefer
 */
export type BriefingMode = 'Military' | 'Economy' | 'Diplomacy';

/**
 * Input type for specialized briefer
 */
export interface SpecializedBrieferInput {
  mode: BriefingMode;
  instruction: string;
}

/**
 * Configuration for a specific briefing mode. System prompt prose lives in
 * `prompts/specialized-briefer.<mode>.md`.
 */
interface ModeConfig {
  eventCategory: EventCategory;
  getDataPrompt: (
    parameters: StrategistParameters,
    events: ConsolidatedEventsReport
  ) => string;
}

/**
 * Military-focused briefing configuration
 */
const militaryConfig: ModeConfig = {
  eventCategory: 'Military',

  getDataPrompt: (parameters, events) => {
    const state = getRecentGameState(parameters)!;
    const filteredPlayers = pickPlayerFields(state.players!, [
      'Civilization', 'Leader', 'TeamID', 'IsMajor', 'Era', 'MilitaryStrength',
      'Score', 'Territory', 'Cities', 'Population', 'GoldenAge', 'Gold', 'GoldPerTurn', 'Technologies', 'PolicyBranches',
      'MilitaryUnits', 'MilitarySupply', 'HappinessSituation', 'Relationships'
    ]);
    const filteredCities = pickCityFields(state.cities!, [
      'ID', 'X', 'Y', 'Population', 'DefenseStrength', 'Health',
      'IsCapital', 'IsPuppet', 'IsOccupied', 'IsCoastal', 'ResistanceTurns', 'RazingTurns',
      'CurrentProduction', 'ProductionTurnsLeft'
    ]);
    return `
# Players
Players: summary reports about visible players in the world.

${jsonToMarkdown(filteredPlayers)}

# Cities
Cities: summary reports about discovered cities in the world.

${jsonToMarkdown(filteredCities)}

# Military
Military: summary reports about tactical zones and visible units.

${jsonToMarkdown(state.military)}

# Events
Events: military-related events since the last decision-making.

${jsonToMarkdown(events)}`.trim();
  },
};

/**
 * Economy-focused briefing configuration
 */
const economyConfig: ModeConfig = {
  eventCategory: 'Economy',

  getDataPrompt: (parameters, events) => {
    const state = getRecentGameState(parameters)!;
    const filteredPlayers = omitPlayerFields(state.players!, [
      'OurOpinionOfThem', 'TheirOpinionOfUs', 'MyEvaluations', 'Spies'
    ]);
    const filteredCities = omitCityFields(state.cities!, [
      'MajorityReligion'
    ]);
    return `
# Victory Progress
Victory Progress: current progress towards each type of victory.

${jsonToMarkdown(state.victory)}

# Players
Players: summary reports about visible players in the world.

${jsonToMarkdown(filteredPlayers)}

# Cities
Cities: summary reports about discovered cities in the world.

${jsonToMarkdown(filteredCities)}

# Events
Events: economy-related events since the last decision-making.

${jsonToMarkdown(events)}`.trim();
  },
};

/**
 * Diplomacy-focused briefing configuration
 */
const diplomacyConfig: ModeConfig = {
  eventCategory: 'Diplomacy',

  getDataPrompt: (parameters, events) => {
    const state = getRecentGameState(parameters)!;
    const filteredPlayers = pickPlayerFields(state.players!, [
      'Civilization', 'Leader', 'IsMajor', 'TeamID', 'Era', 
      'Score', 'Territory', 'MilitaryStrength', 'Cities', 'Population', 'Gold', 'GoldPerTurn',
      'OurOpinionOfThem', 'TheirOpinionOfUs', 'Relationships', 'MyEvaluation', 'PolicyBranches',
      'FoundedReligion', 'MajorityReligion', 'MajorAlly', 'Quests', 'DiplomaticDeals',
      'GoldenAge', 'HappinessSituation', 'Resources', 'ResourcesAvailable', 'IncomingTradeRoutes', 'OutgoingTradeRoutes', 'Spies'
    ]);
    const filteredCities = pickCityFields(state.cities!, [
      'ID', 'X', 'Y', 'Population', 'MajorityReligion',
      'IsCapital', 'IsPuppet', 'IsCoastal', 'IsOccupied', 'FaithPerTurn'
    ]);
    return `
# World Congress
${jsonToMarkdown(state.victory!.DiplomaticVictory)}

# Players
Players: summary reports about visible players in the world.

${jsonToMarkdown(filteredPlayers)}

# Cities
Cities: summary reports about discovered cities in the world.

${jsonToMarkdown(filteredCities)}

# Events
Events: diplomacy-related events since the last decision-making.

${jsonToMarkdown(events)}`.trim();
  },
};

/**
 * Mode configuration registry mapping mode names to their configurations
 */
const modeConfigs: Record<'Military' | 'Economy' | 'Diplomacy', ModeConfig> = {
  Military: militaryConfig,
  Economy: economyConfig,
  Diplomacy: diplomacyConfig
};

/**
 * A specialized briefer agent that focuses on specific game aspects.
 * Provides targeted briefings for Military, Economy, or Diplomacy based on mode selection.
 *
 * @class
 */
export class SpecializedBriefer extends Briefer<SpecializedBrieferInput> {
  /**
   * The name identifier for this agent
   */
  readonly name = "specialized-briefer";

  /**
   * Human-readable description of what this agent does
   */
  readonly description = "Produces specialized briefings focused on Military, Economy, or Diplomacy aspects based on selected mode";

  /**
   * Gets the system prompt for the briefer based on the selected mode
   */
  public async getSystem(
    _parameters: StrategistParameters,
    input: SpecializedBrieferInput,
    context: VoxContext<StrategistParameters>
  ): Promise<string> {
    return renderSystemPrompt(context, `specialized-briefer.${input.mode.toLowerCase()}`);
  }

  /**
   * Gets the initial messages for the conversation using mode-specific message construction
   */
  public async getInitialMessages(
    parameters: StrategistParameters,
    input: SpecializedBrieferInput,
    _context: VoxContext<StrategistParameters>
  ): Promise<ModelMessage[]> {
    const config = modeConfigs[input.mode];
    const state = getRecentGameState(parameters)!;
    const { YouAre, ...SituationData } = parameters.metadata || {};

    // Filter events to the appropriate category. Read the decision window (mergedEvents) when an
    // established strategist window is present, falling back to the immutable per-turn slice.
    // Both are the consolidated format by default.
    const filteredEvents = filterEventsByCategory(
      (state.mergedEvents ?? state.events)! as ConsolidatedEventsReport,
      config.eventCategory
    );

    const messages: ModelMessage[] = [{
      role: "system",
      content: `
You are an expert ${config.eventCategory.toLowerCase()} analyst for ${parameters.metadata?.YouAre!.Leader}, leader of ${parameters.metadata?.YouAre!.Name} (Player ${parameters.playerID ?? 0}).

# Situation
${jsonToMarkdown(SituationData)}

# Your Civilization
${jsonToMarkdown(YouAre)}`.trim(),
      providerOptions: { ...cacheBreakpoint }
    }, {
      role: "user",
      content: `
${config.getDataPrompt(parameters, filteredEvents)}

# Leader's Instruction
You are writing a ${config.eventCategory.toLowerCase()} briefing for ${parameters.metadata?.YouAre!.Leader}, leader of ${parameters.metadata?.YouAre!.Name} (Player ${parameters.playerID ?? 0}), after turn ${parameters.turn}.

${input.instruction}`.trim()
    }];

    // Add past briefing from the closest prior decision point (a turn that actually has a
    // matching briefing), so pacing's skipped turns don't drop the comparison.
    const reportKey = briefingReportKeys[input.mode];
    const lastState = getLastBriefingState(parameters, getOffsetedTurn(parameters, -5), [reportKey, "briefing"]);
    if (lastState) {
      messages.push({
        role: "user",
        content: `# Past Briefing
Past Briefing: your past ${config.eventCategory.toLowerCase()} briefing from ${parameters.turn - lastState.turn} turns ago (turn ${lastState.turn}) for comparison.
${lastState.reports[reportKey] ?? lastState.reports["briefing"]}`
      });
    }

    return messages;
  }

  /**
   * Post-processes the output and stores it in the appropriate report key
   */
  public postprocessOutput(
    parameters: StrategistParameters,
    input: SpecializedBrieferInput,
    output: string
  ): string {
    const reportKey = briefingReportKeys[input.mode];
    parameters.gameStates[parameters.turn].reports[reportKey] = output;
    return output;
  }

  /** Briefers run at the low reasoning tier. */
  protected reasoningTier = "low" as const;

  /**
   * Gets extra tools that this agent provides to the context
   */
  public getExtraTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
    return {
      "focus-briefer": createSimpleTool({
        name: "focus-briefer",
        description: "Set the focus for one of your briefer's next report",
        inputSchema: z.object({
          Mode: z.enum(['Military', 'Economy', 'Diplomacy']).describe("The briefer to instruct"),
          Instruction: z.string().describe("A short paragraph to focus your briefer's **next report**, e.g. what kind of information to prioritize")
        }),
        execute: async (input, parameters) => {
          // Store the instruction in working memory for the next specialized briefing
          parameters.workingMemory[briefingInstructionKeys[input.Mode]] = input.Instruction;
          return `Briefer instruction set for ${input.Mode} mode.`;
        }
      }, context)
    };
  }
}
