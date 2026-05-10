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
import { getGameState, getRecentGameState, StrategistParameters } from "../strategist/strategy-parameters.js";
import { getModelConfig } from "../utils/models/models.js";
import { Model } from "../types/index.js";
import { jsonToMarkdown } from "../utils/tools/json-to-markdown.js";
import { createSimpleTool } from "../utils/tools/simple-tools.js";
import { getOffsetedTurn } from "../utils/prompts/game-speed.js";
import { SimpleBriefer } from "./simple-briefer.js";
import { briefingInstructionKeys } from "./briefing-utils.js";
import { filterEventsByCategory, EventCategory } from "../utils/prompts/event-filters.js";
import { pickPlayerFields, omitPlayerFields, pickCityFields, omitCityFields } from "../utils/prompts/report-filters.js";
import type { ConsolidatedEventsReport } from '../../../mcp-server/dist/tools/knowledge/get-events.js';
import { SimpleStrategistBase } from "../strategist/agents/simple-strategist-base.js";

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
 * Configuration for a specific briefing mode
 */
interface ModeConfig {
  systemPrompt: string;
  eventCategory: EventCategory;
  getDataPrompt: (
    parameters: StrategistParameters,
    events: ConsolidatedEventsReport
  ) => string;
  getReportKey: (mode: BriefingMode) => string;
}

/**
 * Introduction stating the briefer's role for specialized modes
 */
function roleIntro(role: string): string {
  return `You are an expert ${role} for Civilization V with the latest Vox Populi mod.
Your role is to produce a concise ${role.toLowerCase()}-focused briefing based on the current game state, following your leader's instruction.
Your leader only has control over macro-level decision making. Focus on providing relevant ${role.toLowerCase()} information.`;
}

/**
 * Military-focused briefing configuration
 */
const militaryConfig: ModeConfig = {
  systemPrompt: `
${roleIntro('military intelligence analyst')}

# Objective
Summarize the military situation into a strategic briefing that highlights:
- Important military development, esp. for active conflicts, during the past turn.
- Military strength, weakness, and position relative to opponents.
- Potential threats and war plans, considering diplomatic relationships and overall strength.
- High-level needs, growth, or excesses of our military forces.
- Comparison with the last available military briefing.

# Guidelines
${SimpleBriefer.commonGuidelines}

# Resources
You will receive the following reports:
${SimpleStrategistBase.playersInfoPrompt}
${SimpleBriefer.citiesPrompt}
${SimpleBriefer.militaryPrompt}
- Events: military-related events since the last decision-making.
${SimpleBriefer.pastBriefingPrompt}

${SimpleBriefer.instructionFooter}`.trim(),

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

  getReportKey: () => "briefing-military"
};

/**
 * Economy-focused briefing configuration
 */
const economyConfig: ModeConfig = {
  systemPrompt: `
${roleIntro('economic analyst')}

# Objective
Summarize the economic situation into a strategic briefing that highlights:
- Economic position and development relative to opponents.
- High-level needs, growth, or excesses in our economy.
- Peaceful expansion (settlement) opportunities (if eligible).
- Important economic development, technology progress, and policy changes during the past turn.
- Comparison with the last available economic briefing.

# Guidelines
${SimpleBriefer.commonGuidelines}

# Resources
You will receive the following reports:
${SimpleStrategistBase.victoryConditionsPrompt}
${SimpleStrategistBase.playersInfoPrompt}
${SimpleBriefer.citiesPrompt}
- Events: economy-related events since the last decision-making.
${SimpleBriefer.pastBriefingPrompt}

${SimpleBriefer.instructionFooter}`.trim(),

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

  getReportKey: () => "briefing-economy"
};

/**
 * Diplomacy-focused briefing configuration
 */
const diplomacyConfig: ModeConfig = {
  systemPrompt: `
${roleIntro('diplomatic analyst')}

# Objective
Summarize the diplomatic situation into a strategic briefing that highlights:
- Major diplomatic development (declarations of war, peace treaties, friendship, denouncement).
- World Congress activities and resolutions.
- City-state relationships, quests, and influence changes.
- If relevant, religion situation and development. 
- Comparison with the last available diplomatic briefing.

# Guidelines
${SimpleBriefer.commonGuidelines}

# Resources
You will receive the following reports:
${SimpleStrategistBase.playersInfoPrompt}
${SimpleBriefer.citiesPrompt}
- World Congress: votes and resolutions in the World Congress.
- Events: diplomacy-related events since the last decision-making.
${SimpleBriefer.pastBriefingPrompt}

${SimpleBriefer.instructionFooter}`.trim(),

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

  getReportKey: () => "briefing-diplomacy"
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
    _context: VoxContext<StrategistParameters>
  ): Promise<string> {
    const config = modeConfigs[input.mode];
    return config.systemPrompt;
  }

  /**
   * Gets the initial messages for the conversation using mode-specific message construction
   */
  public async getInitialMessages(
    parameters: StrategistParameters,
    input: SpecializedBrieferInput,
    context: VoxContext<StrategistParameters>
  ): Promise<ModelMessage[]> {
    const config = modeConfigs[input.mode];
    const state = getRecentGameState(parameters)!;
    await Briefer.prototype.getInitialMessages.call(this, parameters, input.instruction, context);
    const { YouAre, ...SituationData } = parameters.metadata || {};

    // Filter events to the appropriate category (state.events is consolidated format by default)
    const filteredEvents = filterEventsByCategory(state.events! as ConsolidatedEventsReport, config.eventCategory);

    const messages: ModelMessage[] = [{
      role: "system",
      content: `
You are an expert ${config.eventCategory.toLowerCase()} analyst for ${parameters.metadata?.YouAre!.Leader}, leader of ${parameters.metadata?.YouAre!.Name} (Player ${parameters.playerID ?? 0}).

# Situation
${jsonToMarkdown(SituationData)}

# Your Civilization
${jsonToMarkdown(YouAre)}`.trim(),
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } }
      }
    }, {
      role: "user",
      content: `
${config.getDataPrompt(parameters, filteredEvents)}

# Leader's Instruction
You are writing a ${config.eventCategory.toLowerCase()} briefing for ${parameters.metadata?.YouAre!.Leader}, leader of ${parameters.metadata?.YouAre!.Name} (Player ${parameters.playerID ?? 0}), after turn ${parameters.turn}.

${input.instruction}`.trim()
    }];

    // Add past briefing if available
    const lastState = getGameState(parameters, getOffsetedTurn(parameters, -5));
    const reportKey = config.getReportKey(input.mode);
    if (lastState && (lastState.reports[reportKey] || lastState.reports["briefing"])) {
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
    const config = modeConfigs[input.mode];
    const reportKey = config.getReportKey(input.mode);
    parameters.gameStates[parameters.turn].reports[reportKey] = output;
    return output;
  }

  /**
   * Gets the language model to use for this agent execution
   */
  public getModel(
    _parameters: StrategistParameters,
    _input: unknown,
    overrides: Record<string, Model | string>
  ): Model {
    return getModelConfig(this.name, "low", overrides);
  }

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
