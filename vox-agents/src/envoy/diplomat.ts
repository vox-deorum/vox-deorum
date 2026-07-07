/**
 * @module envoy/diplomat
 *
 * Diplomat envoy agent that represents the civilization in diplomatic interactions.
 * Gathers intelligence through conversations and relays important information
 * to the analyst for assessment via the call-analyst agent-tool.
 */

import { ModelMessage, StepResult, Tool } from "ai";
import { LiveEnvoy, type LiveEnvoyContext } from "./live-envoy.js";
import { VoxContext } from "../infra/vox-context.js";
import { StrategistParameters, getRecentGameState } from "../strategist/strategy-parameters.js";
import { EnvoyThread } from "../types/index.js";
import { worldContext, noDecisionPower, communicationStyle, audienceSection } from "./envoy-prompts.js";
import { createCloseConversationTool } from "./close-conversation-tool.js";
import { buildDealContextMessage, renderDealRowInline } from "./utils/diplomat-utils.js";
import { buildDiplomacyBackgroundMessage } from "./utils/diplomacy-context.js";
import { readActiveProposal } from "../utils/diplomacy/deal.js";
import { counterpartOpenProposal } from "../utils/diplomacy/deal-reduce.js";
import { terminalActionTools, type DealRowRenderer } from "../utils/diplomacy/transcript-utils.js";

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
   * The diplomat only operates inside a civ↔civ diplomacy conversation. The invariant is guaranteed
   * at the `VoxContext.execute` boundary (which rejects it unless the input is a diplomacy thread),
   * so the `prepareStep`/`getInitialMessages` deal-state reads below can assume a counterpart exists;
   * the web chat route, the telepathist CLI, and the chat dialog (which forces the Diplomacy form,
   * never the regular Observer panel) each reject or steer it away up front.
   */
  public override diplomacyOnly = true;

  /**
   * Extends LiveEnvoy's tool set with diplomatic events, analyst reporting, and — for
   * civ↔civ diplomacy conversations — the close-conversation tool.
   */
  public override getActiveTools(_parameters: StrategistParameters): string[] | undefined {
    return [
      "get-briefing",
      "send-message",
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
   * When a deal authored by the **counterpart** is open on the table, the ball is in the diplomat's
   * court, so it is restricted to call-negotiator + send-message — it must either hand the proposal
   * to the negotiator or reply, never wander off into briefings/analyst calls. The gate reads the
   * **authoritative durable reduction** (`readActiveProposal`, the same source the negotiator and the
   * accept/reject routes use), NOT the best-effort in-memory cache, so a stale `open` left by a
   * disconnect on an accept/reject can never wrongly keep restricting the next turn. A proposal our
   * own side authored leaves the ball with the other side and does not restrict us.
   *
   * Special-message (greeting) mode is already restricted to send-message by LiveEnvoy, so the gate
   * is skipped there.
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
    if (lastStep === null && !this.isSpecialMode(input)) {
      // Diplomacy turn, first step: read the authoritative deal state once. The counterpart cannot act
      // mid-turn (the per-thread lock), so the gate state is fixed for the whole turn; and when the gate
      // IS active it restricts to call-negotiator + send-message, both of which end the turn — so there
      // is never a later step to re-restrict. Reading every step would just repeat the same MCP round-trip.
      const reduction = await readActiveProposal(input.player1ID, input.player2ID);
      if (counterpartOpenProposal(reduction, input.agent)) {
        config.activeTools = ["call-negotiator", "send-message"];
      }
    }
    return config;
  }

  /**
   * The diplomat ends its turn by speaking (send-message), handing the deal to the negotiator, or
   * closing the conversation — all terminal wherever they appear. The shared LiveEnvoy stop logic
   * (with the hard step ceiling and the Anthropic free-text fallback) consumes this set.
   */
  protected override getCompletionTools(): Set<string> {
    // send-message (a spoken reply ends the turn) plus the non-spoken terminal tools, sourced from
    // the shared `terminalActionTools` so the retry-suppression predicate can never drift from this set.
    return new Set(["send-message", ...terminalActionTools]);
  }

  /**
   * Grounds the diplomat's turn so it "sees the deal at every step" (specs §7). The cities +
   * standing/concluded-deals background becomes the `preamble`; the on-the-table proposal — ONLY when a
   * deal is genuinely OPEN — becomes the `postscript`, carrying the negotiator's rationale/message and
   * per-item value snapshots so the diplomat can voice each move faithfully; rejected/closed deals
   * render inline at their proposal turn via the `dealRenderer` (see {@link renderDealRowInline}). See
   * {@link LiveEnvoyContext} for how the base layers these around the chat record.
   *
   * The deal transcript is reduced ONCE here from the authoritative durable source (`readActiveProposal`,
   * the same source `prepareStep`'s gate and the accept/reject routes use); the on-the-table block and
   * the renderer's open-proposal pointer both derive from that single reduction — and the pointer keys
   * off the block actually being emitted — so they can never disagree about which proposal is open.
   * (Reducing the in-memory `input.messages` instead risked pointing at a block that was never emitted.)
   * Called by the base only in normal mode, so greeting (special) mode adds none of this.
   */
  protected override async getExtraContext(
    parameters: StrategistParameters,
    input: EnvoyThread,
    context: VoxContext<StrategistParameters>
  ): Promise<LiveEnvoyContext> {
    // The cities/standing background and the durable deal reduction are independent fetches — run them
    // together. buildDealContextMessage below needs both: background.players for third-party context,
    // reduction for the open-deal terms.
    const [background, reduction] = await Promise.all([
      buildDiplomacyBackgroundMessage(context, parameters, input),
      readActiveProposal(input.player1ID, input.player2ID),
    ]);
    const preamble: ModelMessage[] = background.text
      ? [{ role: "user", content: background.text }]
      : [];

    // Our leader's own set-relationship directives ride along the cached game state (no extra fetch).
    const relationships = getRecentGameState(parameters)?.options?.Relationships;
    const dealContext = await buildDealContextMessage(input, reduction, background.players, relationships);
    const postscript: ModelMessage[] = dealContext
      ? [{ role: "user", content: dealContext }]
      : [];

    // The still-open proposal is shown in full in the on-the-table block, so the renderer points its
    // transcript row at that block instead of repeating the terms; every other proposal renders its
    // terms inline (see {@link renderDealRowInline}). Keyed off the block ACTUALLY being emitted
    // (postscript non-empty), so the pointer can never reference a block that isn't there.
    const openProposalID = postscript.length > 0 ? reduction.active?.ID : undefined;
    const dealRenderer: DealRowRenderer = (row) => renderDealRowInline(row, input, openProposalID);

    return { preamble, postscript, dealRenderer };
  }

  /**
   * Gets the system prompt defining the diplomat persona
   */
  public async getSystem(
    _parameters: StrategistParameters,
    input: EnvoyThread,
    _context: VoxContext<StrategistParameters>
  ): Promise<string> {
    const sections = [
      `You are a diplomat serving your civilization.
${worldContext}
You represent your government's interests and gather intelligence through diplomatic conversations. ${noDecisionPower}`,

      `# Your Expectations
- You engage in diplomatic dialogue on behalf of your leader.
- You speak to the counterpart ONLY by calling the \`send-message\` tool.
- You gather intelligence and relay important information back to your leader using the \`call-diplomatic-analyst\` tool.
- You assess the situation and provide context in your reports to help the analyst.
- Validate and reason against current game state: a conversation can outlive the moment it began, so do not assume the world is frozen.
- You do NOT make binding decisions or proposing deals: you report back and let your negotiator decide, by invoking the \`call-negotiator\` tool.
- You always use the correct tool-calling format for each tool provided in the prompt. Double check that before sending out.`,
    ];

    if (!this.isSpecialMode(input)) {
      sections.push(`# Your Resources
- Use the \`send-message\` tool to say something to the counterpart.
  - The \`Message\` you provide is delivered exactly as written, so write the finished reply, not a description of it.
  - Never write a reply as free text outside this tool.
- Use the \`get-briefing\` tool to retrieve briefings on Military, Economy, and/or Diplomacy.
  - Call it when you need strategic intelligence to inform your conversations.
- Use the \`get-diplomatic-events\` tool to retrieve recent diplomatic history with another player.
  - Call it when you need to reference past events or back up your statements.
- Use the \`call-diplomatic-analyst\` tool to send **important** information to the intelligence analyst.
  - Report official statements, proposals, threats, or declarations from other leaders.
  - Report gathered information, rumors, observations, or strategic insights.
  - The analyst will assess reliability, categorize the information, and relay it to the leader.
  - Include your reaction and contextual observations in the report to aid documentation.
  - Do NOT report trivial pleasantries or small talk, only report essential, valuable information.
- Use the \`call-negotiator\` tool to propose or react to diplomatic deals.
  - You never write trade items or promises yourself, instead, the negotiator will handle it.
  - If your proposal is currently on the table, await the counterpart's reply rather than calling the negotiator again.
  - When a deal authored by the counterpart is on the table, either hand it to the negotiator with \`call-negotiator\` or reply with \`send-message\`: do not leave it unanswered.`);
    }

    sections.push(communicationStyle);
    sections.push(audienceSection(this.formatUserDescription(input)));

    return sections.join('\n\n').trim();
  }

  /**
   * The diplomat's normal-mode nudge, concatenated onto the always-last hint: gather and relay
   * intelligence, and speak through send-message. When a deal is OPEN, the on-the-table block (which
   * lands right before this hint, see getExtraContext) states the action for that state directly.
   */
  protected override getDefaultAddon(): string {
    return "When you need to speak directly to the counterpart, use the `send-message` tool. When you need to propose a deal, use the `call-negotiator` tool.";
  }
}
