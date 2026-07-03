/**
 * @module oracle/types
 *
 * Type definitions for the Oracle agent prompt replay system.
 * Oracle replays past agent turns with modified prompts through the same (or different) LLM,
 * capturing results for comparative analysis without touching the game or MCP.
 */

import type { ModelMessage, StepResult, Tool } from 'ai';
import type { AgentParameters } from '../infra/vox-agent.js';
import type { ExecuteTokenOutput } from '../infra/vox-run.js';
import type { Model } from '../types/index.js';
import type { ToolCallFraming } from '../utils/models/tool-rescue/types.js';

/** A single tool call decision from a replay */
export interface ReplayDecision {
  toolName: string;
  args: Record<string, unknown>;
  /** Rationale extracted from the tool's Rationale arg (strategist decision tools only) */
  rationale?: string;
}

/** A row from the input CSV file */
export interface OracleRow {
  game_id: string;
  player_id: string;
  turn: string;
  player_type: string;
  rationale: string;
  /** Any additional columns from the CSV */
  [key: string]: string;
}

/** Context provided to the modifyPrompt callback */
export interface OriginalPromptContext {
  /** The CSV row being processed */
  row: OracleRow;
  /** Original system prompt parts from telemetry (one per system message) */
  system: string[];
  /** Original non-system messages from telemetry */
  messages: ModelMessage[];
  /** Tool names available during the original turn */
  activeTools: string[];
  /** Original model string from telemetry (e.g. 'openai-compatible/Kimi-K2.5@Medium') */
  originalModel: string;
  /** Agent name from telemetry (e.g. 'simple-strategist') */
  agentName: string;
  /**
   * The original turn's prompt-mode framing, recorded explicitly on the span.
   * `undefined` when no framing was recorded: the turn predates the attribute, ran a
   * native (non-prompt) tool path, had no tools, or failed before recording. Informational
   * only — replay framing derives from the replay model, not this. To reproduce the
   * original framing, return a model with `options.framing` from `modelOverride` (which
   * receives this value) or apply `reframeToolWording` to `system`/`toolPrompt` here.
   */
  framing?: ToolCallFraming;
  /**
   * Injected tool prompt in vanilla 'tool' wording, recorded only when that turn
   * was adapted to 'action' framing. Available for experiments (apply
   * `reframeToolWording` to reproduce the action view); does not drive replay framing.
   */
  toolPrompt?: string;
}

/** Return type from the modifyPrompt callback. All fields optional -- undefined keeps original. */
export interface ModifiedPrompt {
  /** Override system prompt parts */
  system?: string[];
  /** Override conversation messages */
  messages?: ModelMessage[];
  /** Override active tools */
  activeTools?: string[];
  /** Arbitrary metadata stored in the trail */
  metadata?: Record<string, any>;
}

/** Options for Oracle batch mode */
export interface BatchOptions {
  /** Time window to collect requests before submitting a batch (ms, default 15000) */
  flushInterval?: number;
  /** How often to poll for batch completion (ms, default 30000) */
  pollInterval?: number;
}

/** Configuration for an Oracle experiment */
export interface OracleConfig {
  /** Input CSV path (relative or absolute) */
  csvPath: string;
  /** Names the output DB and files */
  experimentName: string;
  /** Callback to modify the original prompt before replay */
  modifyPrompt: (ctx: OriginalPromptContext) => ModifiedPrompt | Promise<ModifiedPrompt>;
  /**
   * Override model per-row. Return a single model or an array for multi-model comparison.
   * Array = one ReplayResult per model per source row. Undefined = keep original.
   *
   * The third argument carries the original turn's recorded prompt-mode facts
   * (`framing`/`toolPrompt`, both `undefined` when the turn predates the telemetry or ran a
   * native tool path — see `OriginalPromptContext.framing`). Return a Model with
   * `options.framing` set to reproduce the original framing on the replay model; this is the
   * sanctioned way to force framing, since replay framing otherwise derives solely from the
   * replay model. Distinct source framings can thus be replayed faithfully even when the
   * models resolve to the same name.
   */
  modelOverride?: (
    originalModel: string,
    row: OracleRow,
    original?: { framing?: ToolCallFraming; toolPrompt?: string }
  ) => string | Model | (string | Model)[] | undefined;
  /** Rewrite MCP tool JSON schemas before replay. Receives JSON-stringified { description, inputSchema }, returns modified JSON. */
  rewriteToolSchemas?: (toolJson: string) => string;
  /** Output directory. Default: '../temp/oracle' (relative or absolute) */
  outputDir?: string;
  /** Telemetry directory. Default: 'telemetry' (relative or absolute) */
  telemetryDir?: string;
  /** Target agent name. Default: auto-detect strategist */
  targetAgent?: string;
  /** The type of agent being replayed (e.g. 'strategist', 'spokesperson'). Determines stop behavior. */
  agentType?: string;
  /** Max parallel row executions. Default: 5 */
  concurrency?: number;
  /** Read existing per-task replay trail JSONs as cache. Default: true */
  readCache?: boolean;
  /** Extract custom columns from replay context for the output CSV */
  extractColumns?: (ctx: ExtractionContext) => Record<string, any>;
  /** Filter which CSV rows to process. Return true to include, false to skip. Applied in both retrieve and replay phases. */
  filter?: (row: OracleRow, index: number) => boolean;
  /**
   * Enable batch mode via OpenAI Batch API.
   * Requests are collected over a time window and submitted as a batch for ~50% cost savings.
   * Only supported for openai and openai-compatible providers — others will throw.
   * Set to true for defaults, or pass BatchOptions to customize intervals.
   */
  batch?: boolean | BatchOptions;
  /**
   * Directory name for retrieved data. When set, retrieve phase saves to
   * {outputDir}/{retrievalName}/retrieved/ instead of using experimentName.
   * Multiple experiments can share the same retrievalName to avoid re-retrieving.
   */
  retrievalName?: string;
}

/** Parameters passed to OracleAgent per execution */
export interface OracleParameters extends AgentParameters {
  /** Tool names from the original span */
  activeTools: string[];
  /** Model to use (original or overridden) */
  resolvedModel: Model;
  /** Agent type being replayed -- controls stop behavior */
  agentType?: string;
  /** Set by stopCheck, read by getOutput to collect all steps */
  capturedSteps: StepResult<Record<string, Tool>>[];
}

/** Input to each oracle execution */
export interface OracleInput {
  /** Modified system prompt parts */
  system: string[];
  /** Modified non-system messages */
  messages: ModelMessage[];
  /** CSV row for context */
  row: OracleRow;
  /** Arbitrary metadata from the modifyPrompt callback */
  metadata?: Record<string, any>;
}

/** Result of a single replay */
export interface ReplayResult {
  /** The CSV row that was replayed */
  row: OracleRow;
  /** Model used for replay */
  model: string;
  /** Tool call decisions from the LLM (with extracted rationale for strategist tools) */
  decisions: ReplayDecision[];
  /** Token usage */
  tokens: ExecuteTokenOutput;
  /** Raw LLM response messages for analysis */
  messages: ModelMessage[];
  /** Error message if the replay failed */
  error?: string;
  /** Metadata from the callback */
  metadata?: Record<string, any>;
  /** Custom columns from extractColumns callback */
  extractedColumns?: Record<string, any>;
  /** 1-based repetition index when the same model appears multiple times in modelOverride */
  repetition?: number;
}

/** Context provided to the extractColumns callback */
export interface ExtractionContext {
  /** Original system prompt parts from telemetry */
  originalPrompts: string[];
  /** Original non-system messages from telemetry (user/assistant/tool) */
  originalMessages: ModelMessage[];
  /** Replay system prompt parts (after modifications) */
  replayPrompts: string[];
  /** Tool call decisions from the replay */
  decisions: ReplayDecision[];
  /** Model used for the replay */
  model: string;
  /** The CSV row being processed */
  row: OracleRow;
  /** Agent name from telemetry */
  agentName: string;
}

/** Data extracted from a telemetry span for a single turn */
export interface ExtractedPrompt {
  /** System prompt parts (one per system message) */
  system: string[];
  /** Non-system messages */
  messages: ModelMessage[];
  /** Tool names from step.tools */
  activeTools: string[];
  /** Original model string from span attributes */
  modelString: string;
  /** Agent name (e.g. 'simple-strategist') */
  agentName: string;
  /** The original turn's framing from step.tool_framing (undefined when unrecorded — see OriginalPromptContext.framing) */
  framing?: ToolCallFraming;
  /** Injected tool prompt (vanilla wording) from step.tool_prompt; set only when the turn was adapted to 'action' framing */
  toolPrompt?: string;
}

/** Raw telemetry data extracted for a single CSV row. No prompt modifications applied. */
export interface RetrievedRow {
  /** Original CSV row */
  row: OracleRow;
  /** Raw model string from telemetry (e.g. 'openai-compatible/Kimi-K2.5@Medium') */
  originalModel: string;
  /** Agent name from telemetry (e.g. 'simple-strategist') */
  agentName: string;
  /** Agent type from OracleConfig */
  agentType?: string;
  /** Raw system prompt parts from telemetry (unmodified) */
  system: string[];
  /** Raw non-system messages from telemetry (unmodified) */
  messages: ModelMessage[];
  /** Tool names from the original span */
  activeTools: string[];
  /** The original turn's framing from step.tool_framing (undefined when unrecorded — see OriginalPromptContext.framing) */
  framing?: ToolCallFraming;
  /** Injected tool prompt (vanilla wording) from step.tool_prompt; set only when the turn was adapted to 'action' framing */
  toolPrompt?: string;
  /** Set when extraction failed for this row */
  error?: string;
}
