/**
 * @module envoy/diplomat
 *
 * Diplomat envoy agent that represents the civilization in diplomatic interactions.
 * Gathers intelligence through conversations and relays important information
 * to the analyst for assessment via the call-analyst agent-tool.
 */

import { ModelMessage, StepResult, Tool } from "ai";
import { LiveEnvoy } from "./live-envoy.js";
import { VoxContext } from "../infra/vox-context.js";
import { StrategistParameters } from "../strategist/strategy-parameters.js";
import { EnvoyThread, SpecialMessageConfig } from "../types/index.js";
import { worldContext, noDecisionPower, communicationStyle, audienceSection, greetingSpecialMessages } from "./envoy-prompts.js";
import { createCloseConversationTool } from "./close-conversation-tool.js";
import { buildDealContextMessage } from "./diplomat-deal-tools.js";

/**
 * Diplomat agent that engages in diplomatic dialogue and gathers intelligence.
 * Unlike the Spokesperson (which only conveys existing positions), the Diplomat
 * actively collects information and relays it to the analyst for processing.
 *
 * @class
 */
export class Diplomat extends LiveEnvoy {
  /**
   * The name identifier for this agent
   */
  readonly name = "diplomat";

  /**
   * Human-readable description of what this agent does
   */
  readonly description = "A diplomat who engages in diplomatic dialogue, gathers intelligence, and relays important information to the analyst";

  /**
   * Tags for categorizing this agent
   */
  public tags = ["active-game", "diplomatic"];

  /**
   * Extends LiveEnvoy's tool set with diplomatic events, analyst reporting, and — for
   * civ↔civ diplomacy conversations — the close-conversation tool.
   */
  public override getActiveTools(_parameters: StrategistParameters): string[] | undefined {
    return [
      "get-briefing",
      "get-diplomatic-events",
      "call-diplomatic-analyst",
      "close-conversation",
      "call-negotiator",
    ];
  }

  /**
   * Provides the close-conversation tool alongside LiveEnvoy's get-briefing tool. The negotiator
   * is reached through the auto-registered `call-negotiator` handoff (no bespoke relay tools).
   */
  public override getExtraTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
    return {
      ...super.getExtraTools(context),
      "close-conversation": createCloseConversationTool(context),
    };
  }

  /**
   * Gates close-conversation and the negotiator handoff to civ↔civ diplomacy threads — they are
   * meaningless for an observer chat (endpoint A = -1), and special-message (greeting) mode
   * needs no tools.
   */
  public override async prepareStep(
    parameters: StrategistParameters,
    input: EnvoyThread,
    lastStep: StepResult<Record<string, Tool>> | null,
    allSteps: StepResult<Record<string, Tool>>[],
    messages: ModelMessage[],
    context: VoxContext<StrategistParameters>
  ) {
    const config = await super.prepareStep(parameters, input, lastStep, allSteps, messages, context);
    if (!input.diplomacy && config.activeTools) {
      const diplomacyOnly = new Set(["close-conversation", "call-negotiator"]);
      config.activeTools = config.activeTools.filter((t) => !diplomacyOnly.has(t));
    }
    return config;
  }

  /**
   * Adds the on-the-table deal to the diplomat's context so it "sees the deal at every step"
   * (specs §7) — the active proposal's terms, the negotiator's rationale/message, and the
   * per-item value snapshots — so it can voice each move faithfully and keep its intelligence
   * current. Skipped in special-message (greeting) mode and for non-diplomacy chats.
   */
  public override async getInitialMessages(
    parameters: StrategistParameters,
    input: EnvoyThread,
    context: VoxContext<StrategistParameters>
  ): Promise<ModelMessage[]> {
    const messages = await super.getInitialMessages(parameters, input, context);
    if (input.diplomacy && !this.isSpecialMode(input)) {
      const dealContext = await buildDealContextMessage(input);
      if (dealContext) {
        messages.push({ role: "user", content: dealContext });
      }
    }
    return messages;
  }

  /**
   * Gets the system prompt defining the diplomat persona
   */
  public async getSystem(
    parameters: StrategistParameters,
    input: EnvoyThread,
    _context: VoxContext<StrategistParameters>
  ): Promise<string> {
    const sections = [
      `You are a diplomat serving your civilization.
${worldContext}
You represent your government's interests and gather intelligence through diplomatic conversations. ${noDecisionPower}`,

      `# Your Expectation
- You engage in diplomatic dialogue on behalf of your leader
- You gather intelligence and relay important information back to your leader using the \`call-diplomatic-analyst\` tool
- You assess the situation and provide context in your reports to help the analyst
- You do NOT make binding decisions or agreements: you report back and let your leader decide
- You do NOT author deal terms yourself — your negotiator decides them. You only relay context to it and voice its moves.`,
    ];

    if (!this.isSpecialMode(input)) {
      sections.push(`# Your Resources
- Use the \`get-briefing\` tool to retrieve briefings on Military, Economy, and/or Diplomacy
  - Call it when you need strategic intelligence to inform your conversations
- Use the \`get-diplomatic-events\` tool to retrieve recent diplomatic history with another player
  - Call it when you need to reference past events or back up your statements.
- Use the \`call-diplomatic-analyst\` tool to send important information to the intelligence analyst
  - Report official statements, proposals, threats, or declarations from other leaders
  - Report gathered information, rumors, observations, or strategic insights
  - The analyst will assess reliability, categorize the information, and relay it to the leader
  - Include your reaction and contextual observations in the report to aid documentation
  - Do NOT report trivial pleasantries or small talk — only actionable information

# Negotiating Deals
- Your negotiator is the SOLE decider of deal terms. You never write trade items or promises yourself.
- Use the \`call-negotiator\` tool to hand it the conversational context. Always pass a short \`Briefing\` (what the counterpart wants, the tenor of the exchange, anything it should know); add an \`Intent\` when you want to OPEN a deal (what you hope it achieves — but NO terms).
- The negotiator reads the game itself and decides what to do: if a deal from the counterpart is on the table it will accept, counter, or reject it; otherwise it constructs an opening proposal. It returns its move for you to voice.
- If you authored the proposal that is currently on the table, await the counterpart's reply rather than calling the negotiator again.
- After the tool returns, voice the negotiator's move in your own words: elaborate around its one-sentence line for a counter/proposal, and reason from its rationale (never quote the rationale verbatim).
- Validate and reason against current game state — a conversation can outlive the moment it began, so do not assume the world is frozen.`);
    }

    sections.push(communicationStyle);
    sections.push(audienceSection(this.formatUserDescription(parameters, input)));

    return sections.join('\n\n').trim();
  }

  /**
   * Returns the contextual hint that anchors the LLM on its identity and audience.
   */
  protected getHint(parameters: StrategistParameters, input: EnvoyThread): string {
    const { name: civName, leader } = this.getSelfIdentity(parameters);
    return `**HINT**: You are a diplomat for ${civName}, serving ${leader}. You are speaking to ${this.formatUserDescription(parameters, input)}. Gather intelligence and relay important information to the analyst. The time is at turn ${parameters.turn}.`;
  }

  /**
   * Returns the special message configurations for the Diplomat.
   * Supports {{{Greeting}}} for diplomatic introductions.
   */
  protected getSpecialMessages(): Record<string, SpecialMessageConfig> {
    return greetingSpecialMessages;
  }
}
