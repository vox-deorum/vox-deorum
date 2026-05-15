/**
 * @module types/config
 *
 * Core configuration types for Vox Agents.
 * Contains transport, LLM, and main configuration structures.
 */

/**
 * Transport types supported by the MCP Client
 */
export type TransportType = 'stdio' | 'http';

/**
 * Tool middleware types for LLM configuration
 */
export type ToolMiddlewareType = 'prompt' | 'rescue' | 'gemma';

/**
 * LLM model configuration for backend processing
 */
export interface LLMConfig {
  id?: string;
  provider: string;
  name: string;
  options?: {
    toolMiddleware?: ToolMiddlewareType;
    thinkMiddleware?: string;
    concurrencyLimit?: number;
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
    systemPromptFirst?: boolean;
    /** When set, marks this model as an embedding model; value is the target embedding dimension */
    embeddingSize?: number;
    [key: string]: any;
  };
}

/**
 * Version information structure
 */
export interface VersionInfo {
  version: string;  // Full version string like "0.1.0 (b559c18)"
  major: number;
  minor: number;
  revision: number;
  commit?: string;  // Git commit hash
}

/**
 * Main Vox Agents configuration structure
 */
export interface VoxAgentsConfig {
  agent: {
    name: string;
  };
  versionInfo?: VersionInfo;
  webui: {
    port: number;
    enabled: boolean;
  };
  mcpServer: {
    transport: {
      type: TransportType;
      endpoint?: string;
      command?: string;
      args?: string[];
    };
  };
  logging: {
    level: string;
  };
  llms: Record<string, string | LLMConfig>;
  configsDir: string;
  /** Path to the DuckDB episode database used by the archivist and reader */
  episodeDbPath: string;
  /** Directory for telemetry and telepathist databases. Empty string uses default 'telemetry' */
  telemetryDir: string;
  /** OBS Studio configuration for production modes */
  obs?: ObsConfig;
}

/**
 * Type alias for backward compatibility
 */
export type Model = LLMConfig;

/**
 * Agent-to-model mapping
 * Maps an agent name to a model identifier
 */
export interface AgentMapping {
  /** Name of the agent (e.g., 'default', 'briefer', 'strategist') */
  agent: string;
  /** Model identifier to use for this agent (e.g., 'openai/gpt-4') */
  model: string;
}

/**
 * Represents a configuration file for Vox Agents
 */
export interface ConfigFile {
  /** Configuration filename */
  name: string;
  /** Configuration content as JSON object */
  content: Record<string, any>;
  /** ISO timestamp of last modification */
  lastModified?: string;
}

/** All supported session types */
export type SessionType =
  | 'strategist'
  | 'narrator-assemble'
  | 'narrator-select'
  | 'narrator-script'
  | 'narrator-voice'
  | 'narrator-video';

/**
 * Base configuration for all session types.
 * Contains common settings shared across different session implementations.
 */
export interface SessionConfig {
  /** Configuration name (typically derived from filename) */
  name: string;

  /** Session type identifier */
  type: SessionType;

  /** Whether to automatically continue playing when it's the AI's turn */
  autoPlay: boolean;

  /** How to start the game session */
  gameMode: 'start' | 'load' | 'wait';

  /**
   * Number of games to play in sequence (optional).
   * Pass `"auto"` to run until the current seating × seed cycle is fully completed
   * (each cell consumed by a successful run). Useful with `randomizeSeating: true`
   * and/or a `randomSeeds` array.
   */
  repetition?: number | "auto";
}

/**
 * Optional Civilization V random seed controls.
 * `sync` maps to config.ini's SyncRandSeed, `map` maps to MapRandSeed.
 * Omitted values are written as 0 when launching a new game so Civ chooses them.
 */
export interface RandomSeedsConfig {
  sync?: number;
  map?: number;
}

/**
 * Player-specific configuration for LLM control
 */
export interface PlayerConfig {
  /** Strategist type to use for this player */
  strategist: string;
  /** Strategist's decision-making mode */
  mode?: StrategyDecisionType;
  /** Optional LLM model overrides per voxcontext (e.g., per agent name) */
  llms?: Record<string, Model | string>;
}

/**
 * Decision type the strategist is going to make. Either through in-game preset strategy, or through flavors.
 */
export type StrategyDecisionType = "Strategy" | "Flavor";

/**
 * Production mode for game sessions.
 * Controls animation behavior and OBS Studio integration.
 *
 * - `"none"` (default): Skip animations in autoplay, toggle strategic view
 * - `"test"`: Play animations, don't toggle strategic view, no OBS
 * - `"livestream"`: Play animations, don't toggle strategic view, OBS streaming
 * - `"recording"`: Play animations, don't toggle strategic view, OBS recording with file timestamps
 */
export type ProductionMode = 'none' | 'test' | 'livestream' | 'recording';

/**
 * OBS Studio configuration for production modes that use OBS (livestream, recording).
 */
export interface ObsConfig {
  /** Path to obs64.exe. Auto-detected if not set. */
  executablePath?: string;
  /** OBS WebSocket port (default: 4455) */
  wsPort?: number;
  /** OBS WebSocket password */
  wsPassword?: string;
  /** OBS profile name to use */
  profile?: string;
  /** OBS scene collection name to use */
  sceneCollection?: string;
  /** OBS scene name for game capture */
  scene?: string;
  /** Directory for recording output files */
  recordingOutputDir?: string;
  /** Path to static image shown during paused livestream */
  pauseImagePath?: string;
}

/**
 * Returns true for production modes that should play animations and not toggle strategic view.
 * Used for: test, livestream, recording.
 */
export function isVisualMode(mode?: ProductionMode): boolean {
  return mode === 'test' || mode === 'livestream' || mode === 'recording';
}

/**
 * Returns true for production modes that require OBS Studio.
 * Used for: livestream, recording.
 */
export function isObsMode(mode?: ProductionMode): boolean {
  return mode === 'livestream' || mode === 'recording';
}

/**
 * Configuration specific to Strategist sessions.
 * Extends base config with player-specific LLM settings.
 */
export interface StrategistSessionConfig extends SessionConfig {
  /** Must be 'strategist' for this config type */
  type: 'strategist';

  /** Map of player IDs to their LLM configurations */
  llmPlayers: Record<number, PlayerConfig>;

  /**
   * Controls randomization of the mapping between config slots and actual game
   * player indices.
   *
   * - `false` / `undefined`: identity seating — configSlot N → seat N.
   * - `true`: alias for `0` — engages the seeded cycle with seed `0`.
   * - `<uint32>`: deterministic seeded cycle. Both the seating permutation
   *   and the cycle's consumption order are derived from this seed via
   *   `seedrandom`, so the same config reproduces the same cycle on every
   *   machine. Across cycle resets the seed advances so cycle #2 isn't
   *   identical to cycle #1.
   */
  randomizeSeating?: boolean | number;

  /**
   * Optional fixed Civ V random seeds for reproducible starts.
   * Single object: applied to every game.
   * Array: each entry becomes a seed-set in the cycle — the seating cycle expands to
   * `playerCount × randomSeeds.length` cells, so every (seat-rotation, seed-set) pair
   * is exercised once per cycle.
   */
  randomSeeds?: RandomSeedsConfig | RandomSeedsConfig[];

  /** Production mode controlling animations and OBS integration */
  production?: ProductionMode;
}
