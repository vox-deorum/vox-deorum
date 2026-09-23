/**
 * @module analyst/analyst
 *
 * Base analyst agent implementation. All analysts inherit from this class.
 * Analysts run as fire-and-forget agent-tools, processing information asynchronously
 * and relaying assessed results via MCP tools. They share game context (identity,
 * players, strategies) and decide whether information warrants relay to the leader.
 */

import { z } from "zod";
import { ModelMessage } from "ai";
import { VoxAgent } from "../infra/vox-agent.js";
import { StrategistParameters, buildGameContextMessages } from "../strategist/strategy-parameters.js";

/** Base input type for all analysts, provided by the calling agent. */
export interface AnalystInput {
  /** The main content/report to analyze */
  Content: string;
  /** Context about the situation or source */
  Context: string;
  /** The diplomat's assessment and planned response */
  Memo: string;
  /** Civilization that sourced the report. Defaults to the conversation counterpart. */
  FromPlayer?: string;
  /** Civilizations discussed by the report. Extracted from content and memo when omitted. */
  AboutPlayers?: string[];
  /** Player IDs resolved by the analyst before detached execution. */
  _playerIDs?: { FromPlayerID: number; AboutPlayerIDs: number[] };
}

/**
 * Base analyst agent that processes information asynchronously.
 * Runs as a fire-and-forget agent-tool with a detached trace context.
 * Provides analysts with shared game context via getContextMessages().
 *
 * @abstract
 * @class
 */
export abstract class Analyst extends VoxAgent<StrategistParameters, AnalystInput, string> {
  /** Analysts evaluate reports using the routine model. */
  public modelSize = 'small' as const;

  /**
   * Run asynchronously so the calling agent does not wait for completion.
   */
  public override fireAndForget: boolean = true;

  /**
   * Base input schema for reports and optional civilization names.
   */
  public override inputSchema = z.object({
    Content: z.string().min(1).describe("The main content/report to analyze"),
    Context: z.string().describe("Brief context about the situation or source"),
    Memo: z.string().min(1).describe("The diplomat's assessment and planned response"),
    FromPlayer: z.string().optional().describe("Source civilization or leader; defaults to the conversation counterpart"),
    AboutPlayers: z.array(z.string()).optional().describe("Civilizations or leaders discussed; extracted from Content and Memo when omitted, or use an empty array for no subjects")
  });

  /**
   * Returns game context messages: civilization identity, players, and strategies.
   * Shared with LiveEnvoy so analysts have the same baseline information access as envoys.
   */
  protected getContextMessages(parameters: StrategistParameters): ModelMessage[] {
    return buildGameContextMessages(parameters);
  }
}
