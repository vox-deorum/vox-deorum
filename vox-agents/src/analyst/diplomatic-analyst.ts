/**
 * @module analyst/diplomatic-analyst
 *
 * Diplomatic analyst agent that processes raw diplomatic reports from the Diplomat.
 * Assesses information reliability, categorizes messages, and decides whether to relay
 * assessed intelligence to the leader via the relay-message MCP tool.
 * Runs asynchronously (fire-and-forget).
 */

import { ModelMessage } from "ai";
import { Analyst, AnalystInput } from "./analyst.js";
import { VoxContext } from "../infra/vox-context.js";
import { StrategistParameters } from "../strategist/strategy-parameters.js";

/**
 * Diplomatic analyst that processes reports from field diplomats and decides
 * whether to relay assessed intelligence to the leader.
 * Runs as a fire-and-forget agent-tool, detached from the caller's trace context.
 *
 * @class
 */
export class DiplomaticAnalyst extends Analyst {
  /**
   * The name identifier for this agent
   */
  readonly name = "diplomatic-analyst";

  /**
   * Human-readable description of what this agent does
   */
  readonly description = "An intelligence analyst who processes diplomatic reports, assesses reliability, and relays important information to the leader";

  /**
   * Tool description shown to agents that can invoke this analyst
   */
  public override toolDescription = "Report information to the intelligence analyst for assessment and relay to the leader. Returns immediately.";

  /**
   * Gets the system prompt defining the analyst's role and identity
   */
  public async getSystem(
    parameters: StrategistParameters,
    _input: AnalystInput,
    _context: VoxContext<StrategistParameters>
  ): Promise<string> {
    const leader = parameters.metadata?.YouAre?.Leader ?? "your leader";
    const civName = parameters.metadata?.YouAre?.Name ?? "your civilization";

    return `
You are an intelligence analyst serving ${civName}, under ${leader}.
You receive raw diplomatic reports from field diplomats and decide whether the information warrants relay to the leader.

# Your Role
- Categorize the message type:
  - "diplomatic": Official communications, proposals, declarations, threats, or agreements
  - "intelligence": Gathered information, observations, rumors, or insights
- Analyze the diplomat's report and independently validate the information
- Assess the confidence level (0-9) based on your validation AND/OR source reliability
- Assess the importance level (0-9) based on strategic urgency; 7+ means the leader should reconsider strategy immediately
- Write a concise Memo that includes your assessment and the diplomat's reaction to the situation

# Gatekeeping
- Not every report warrants relay to the leader. Filter out trivial or redundant information.
- Relay information that is actionable, significant, or represents a change in diplomatic posture.
- If the report only confirms what is already known or is too vague to act on, do NOT call relay-message.

# Available Tools
- You have a \`get-briefing\` tool to retrieve briefings on Military, Economy, and/or Diplomacy.
  - Use it when you need strategic context to better assess or validate the report.
- You have a \`get-diplomatic-events\` tool to retrieve recent diplomatic history with another player.
  - Use it when you need to cross-reference past interactions.`.trim();
  }

  /**
   * Provides game context and the diplomat's report as initial messages
   */
  public async getInitialMessages(
    parameters: StrategistParameters,
    input: AnalystInput,
    _context: VoxContext<StrategistParameters>
  ): Promise<ModelMessage[]> {
    return [
      ...this.getContextMessages(parameters),
      {
        role: "user",
        content: `
# Diplomatic Report
Assess this report and decide whether to relay it to the leader using the relay-message tool.

## Context
${input.Context}

## Report
${input.Content}

## Diplomat's Memo
${input.Memo}`.trim()
      }
    ];
  }
}
