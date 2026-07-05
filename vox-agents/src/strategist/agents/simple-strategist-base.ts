/**
 * @module strategist/simple-strategist-base
 *
 * Base class for simple strategist agent implementations.
 * Provides common functionality for high-level strategic decision-making in Civilization V.
 */

import { Strategist } from "../strategist.js";
import { StrategistParameters } from "../strategy-parameters.js";
import { StrategyDecisionType } from "../../types/config.js";
import { buildRequiredToolsNudge } from "../../utils/tools/terminal-tools.js";

/** Builds a mode-aware nudge reminding the model to finalize its strategic decision */
function buildStrategistNudge(parameters: StrategistParameters): string {
  const decisionTool = parameters.mode === "Flavor" ? "set-flavors" : "set-strategy";
  return buildRequiredToolsNudge([decisionTool, "keep-status-quo"])!;
}

/**
 * Base class for simple strategist agents.
 * Provides common tools and stop condition logic for strategic decision-making.
 *
 * @abstract
 * @class
 */
export abstract class SimpleStrategistBase extends Strategist {
  public removeUsedTools: boolean = true;
  public requiredTools = ["set-strategy", "set-flavors", "keep-status-quo"];
  public maxSteps = 5;

  public override continuationNudge(parameters: StrategistParameters): string {
    return buildStrategistNudge(parameters);
  }

  // ============================================================
  // System Section Prompts (for getSystem method)
  // ============================================================

  /**
   * Shared prompt: Expert player introduction
   */
  public static readonly expertPlayerPrompt = `You are an expert player playing Civilization V with the latest Vox Populi mod.`;

  /**
   * Shared prompt: Expectation about delegating tactical decisions
   */
  public static readonly expectationPrompt = `# Expectation
- Due to the complexity of the game, you delegate the tactical level decision-making (e.g., unit deployment, city management, scouting) to an in-game AI.
- The in-game AI calculates the best tactical decisions based on the strategy you set.
- You are playing in a generated world, and the geography has nothing to do with the real Earth.
- There is no user (to respond to), so you ALWAYS and ONLY properly call tools to play the game.
- You can interact with multiple tools at a time. Used tools will be removed from the available list.
- Focus on the **macro-level** gameplay strategy (instead of coordinates etc.), as you DON'T have direct control over tactical actions.
- The world is complicated and dynamic. Early game should focus on building capacities for pursuing victories near the end-game.
- Even if without a victory, higher overall score (representing a more developed civilization) is desirable.`;

  /**
   * Shared prompt: Goals for strategic decision-making
   */
  public static readonly goalsPrompt = `# Goals
Your goal is to **call as many tools as you need** to make high-level decisions for the in-game AI.
- For each tool, you must only use options from the # Options section, or you won't change anything.
- Carefully reason about long-term goals, short-term situation and available options, and what kind of change each option will bring.
  - Analyze both your situation and your opponents. Avoid wishful thinking.
- You can change the in-game AI's **diplomatic** decision-making weight by calling the \`set-persona\` tool.
- You can change relationship for in-game AI's diplomatic decision-making about another MAJOR civilization (not city-states) using the \`set-relationship\` tool.
  - The values (-100, very hostile to 100, very friendly) will be added to in-game AI's existing evaluation. Higher values increase peace acceptance, and vice versa.
  - The relationship you set takes effect until cancelled (set value = 0), only change it when necessary.
- You can change the in-game AI's NEXT technology to research (when completing the ongoing one) by calling the \`set-research\` tool.
- You can change the in-game AI's NEXT policy to adopt (when you accumulate enough culture) by calling the \`set-policy\` tool.`;

  /**
   * Shared prompt: Briefer capabilities and limitations
   */
  public static readonly brieferCapabilitiesPrompt = ` - Your briefer(s) ONLY have limited information of the current game state.
  - Your briefer(s) DO NOT have control over tactical decisions and cannot predict tactical AI's next decision.
  - Your briefer(s) ARE BEST on summarizing and synthesizing factual information, NOT analyzing, projecting, or predicting.`;

  /**
   * Shared prompt: Decision-making description in the Strategy mode
   */
  public static getDecisionPrompt(mode: StrategyDecisionType) {
    return `- Each turn, you must call either \`${mode == "Flavor" ? "set-flavors" : "set-strategy"}\` or \`keep-status-quo\` tool.
  - Set an appropriate grand (long-term) strategy and ${mode == "Flavor" ? "additional short-term flavors" : "short-term economic/military strategies"} by calling the \`${mode == "Flavor" ? "set-flavors" : "set-strategy"}\` tool.
  - Alternatively, use the tool \`keep-status-quo\` to keep strategies the same.
  - ${mode === "Flavor" ? "Flavors" : "Strategies"} change the weight of the in-game AI's NEXT decision. It only takes effect AFTER existing queues.${mode === "Flavor" ? "\n  - Flavor ranges from 0 (completely deprioritizes) to 50 (balanced) to 100 (completely prioritizes). Too many priorities weaken impact for each." : ""}
  - You can pursue multiple synergistic victory pathways. Balance between long-term goals and short-term needs.
- Always provide a short paragraph of rationale for each tool. You will read this rationale next turn.`;
  }

  // ============================================================
  // Resource Section Prompts (for Resources section)
  // ============================================================

  /**
   * Shared prompt: Options resource description
   */
  public static readonly optionsDescriptionPrompt = `- Options: available strategic options for you.
  - Whatever decision-making tool you call, the in-game AI can only execute options here.
  - When using tools, you must choose available options from # Options. Double-check if your choices match.
  - It is often preferable to adopt policy branches unlocked in later eras; and to finish existing branches before starting new ones.`;

  /**
   * Shared prompt: Strategies resource description
   */
  public static readonly strategiesDescriptionPrompt = `- Strategies: existing strategic decisions and rationale from you.
  - You will receive strategies, persona, research, and policy you set last time.`;

  /**
   * Shared prompt: Victory conditions description
   */
  public static readonly victoryConditionsPrompt = `- Victory Progress:
  - Domination Victory: Control or vassalize all original capitals.
    - Vassals cannot achieve a domination victory before independence.
  - Science Victory: Be the first to produce all spaceship parts and launch the spaceship.
    - Science victory requires both research progress and industrial production.
  - Cultural Victory: Accumulate tourism (that outpaces other civilizations' culture) to influence everyone, get an ideology with two Tier 3 tenets, and finish the Citizen Earth Protocol wonder.
    - Open borders, trade routes, and shared religion increase tourism. Too many cities decrease it.
  - Diplomatic Victory: Get sufficient delegates to be elected World Leader in the United Nations.
    - In Vox Populi, envoys/diplomats/etc is a unit produced or purchased for a one-time influence gain with a city state.
  - Time Victory: If no one achieves any other victory by the end of the game, the civilization with the highest score wins.`;

  /**
   * Shared prompt: Players information description
   */
  public static readonly playersInfoPrompt = `- Players: summary reports about visible players in the world.
  - You will receive in-game AI's diplomatic evaluations.
  - You will receive each player's publicly available relationships.
  - You will receive the best available location for your next settlement.`;

  /**
   * Shared prompt: Specialized briefer goal (focus-briefer tool + capabilities)
   */
  public static readonly specializedBrieferGoalPrompt = `- You can ask your specialized briefers to prepare focused reports (only for) the next turn by calling the \`focus-briefer\` tool.
  - You have three specialized briefers: Military, Economy, and Diplomacy analysts.
  - Only ask for information relevant to the macro-level decisions in your control. `;

  /**
   * Shared prompt: Briefings resource description
   */
  public static readonly briefingsResourcePrompt = `- Briefings: prepared by your specialized briefers, covering Military, Economy, and Diplomacy aspects.
  - You will make independent and wise judgment based on all briefings.`;

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