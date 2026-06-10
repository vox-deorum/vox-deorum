/**
 * @module analyst/analyst
 *
 * Base analyst agent implementation. All analysts inherit from this class.
 * Analysts run as fire-and-forget agent-tools, processing information asynchronously
 * and relaying assessed results via MCP tools. They share game context (identity,
 * players, strategies) and decide whether information warrants relay to the leader.
 */

import { z } from "zod";
import { ModelMessage, Tool } from "ai";
import { VoxAgent } from "../infra/vox-agent.js";
import { VoxContext } from "../infra/vox-context.js";
import { StrategistParameters, buildGameContextMessages } from "../strategist/strategy-parameters.js";
import { createBriefingTool } from "../briefer/briefing-utils.js";

/** Base input type for all analysts — fields provided by the calling agent */
export interface AnalystInput {
  /** The main content/report to analyze */
  Content: string;
  /** Context about the situation or source */
  Context: string;
  /** The diplomat's assessment and planned response */
  Memo: string;
}

/**
 * Base analyst agent that processes information asynchronously.
 * Runs as a fire-and-forget agent-tool with a detached trace context.
 * Provides all analysts with relay-message, get-briefing, and get-diplomatic-events tools,
 * plus game context (identity, players, strategies) via getContextMessages().
 *
 * @abstract
 * @class
 */
export abstract class Analyst<TInput extends AnalystInput = AnalystInput> extends VoxAgent<StrategistParameters, TInput, string> {
  /**
   * Allow the LLM to decide when to call tools
   */
  public override toolChoice: string = "auto";

  /**
   * Run asynchronously — the calling agent does not wait for completion
   */
  public override fireAndForget: boolean = true;

  /**
   * Base input schema for all analysts: Content, Context, and Memo.
   * PlayerID and Turn are read from parameters (auto-completed).
   */
  public override inputSchema = z.object({
    Content: z.string().describe("The main content/report to analyze"),
    Context: z.string().describe("Brief context about the situation or source"),
    Memo: z.string().describe("The diplomat's assessment and planned response")
  }) as unknown as z.ZodSchema<TInput>;

  /**
   * Base active tools for all analysts: relay-message for output, get-briefing and get-diplomatic-events for context
   */
  public getActiveTools(_parameters: StrategistParameters): string[] | undefined {
    return ["relay-message", "get-briefing", "get-diplomatic-events"];
  }

  /**
   * Provides the get-briefing internal tool for on-demand briefing retrieval
   */
  public override getExtraTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
    return { "get-briefing": createBriefingTool(context) };
  }

  /**
   * Returns game context messages: civilization identity, players, and strategies.
   * Shared with LiveEnvoy so analysts have the same baseline information access as envoys.
   */
  protected getContextMessages(parameters: StrategistParameters): ModelMessage[] {
    return buildGameContextMessages(parameters);
  }
}
