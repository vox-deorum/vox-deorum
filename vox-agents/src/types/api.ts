/**
 * @module types/api
 *
 * API response types for Vox Agents.
 * Contains all types for HTTP endpoint responses and requests.
 */

import type { Span, TelemetryMetadata, TelemetrySession } from './telemetry.js';
import type { EnvoyThread } from './chat.js';
import type { PlayersReport } from '../../../mcp-server/dist/tools/knowledge/get-players.js';

// Re-export types that are used in API responses
export type { PlayersReport };

// ============================================================================
// Core API Response Types
// ============================================================================

/**
 * Represents the health status of the Vox Agents service
 */
export interface HealthStatus {
  /** Service health status (e.g., "healthy", "unhealthy") */
  status?: string;
  /** ISO timestamp of when the health check was performed */
  timestamp: string;
  /** Name of the service being checked */
  service: string;
  /** Optional version string of the service */
  version?: string;
  /** Service uptime in seconds */
  uptime?: number;
  /** Number of connected clients */
  clients?: number;
  /** Port the service is running on */
  port?: number;
}

/**
 * Standard error response format for API failures
 */
export interface ErrorResponse {
  /** Main error message */
  error: string;
  /** Additional error details or stack trace */
  details?: string;
}

/**
 * Represents a single log entry from the Vox Agents system
 */
export interface LogEntry {
  /** ISO timestamp of when the log was created */
  timestamp: string;
  /** Log severity level */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** The log message content */
  message: string;
  /** Source component that generated the log */
  context: string;
  /** Source that generated the log */
  source: string;
  /** Additional structured parameters associated with the log */
  params?: Record<string, any>;
}

// ============================================================================
// Configuration API Response Types
// ============================================================================

/**
 * Response containing a list of available configuration files
 */
export interface ConfigListResponse {
  /** Array of configuration filenames */
  configs: string[];
}

/**
 * API response for configuration endpoint
 */
export interface ConfigResponse {
  /** Main configuration from config.json */
  config: import('./config.js').VoxAgentsConfig;
  /** API keys from .env file */
  apiKeys: Record<string, string>;
}

// ============================================================================
// Session API Response Types
// ============================================================================

// ============================================================================
// Telemetry API Response Types
// ============================================================================

/**
 * Response containing a list of available telemetry databases
 */
export interface TelemetryDatabasesResponse {
  /** Array of telemetry database metadata */
  databases: TelemetryMetadata[];
}

/**
 * Response containing a list of active telemetry sessions
 */
export interface TelemetrySessionsResponse {
  /** Array of active sessions with parsed metadata */
  sessions: TelemetrySession[];
}

/**
 * Response containing spans for a specific session
 */
export interface SessionSpansResponse {
  /** Array of spans belonging to the session */
  spans: Span[];
}

/**
 * Response containing root spans (traces) from a database
 */
export interface DatabaseTracesResponse {
  /** Array of root spans that represent complete traces */
  traces: Span[];
}

/**
 * Response containing all spans for a specific trace
 */
export interface TraceSpansResponse {
  /** Array of spans belonging to the same trace */
  spans: Span[];
}

/**
 * Response after uploading a telemetry database file
 */
export interface UploadResponse {
  /** Whether the upload was successful */
  success: boolean;
  /** Name of the uploaded file */
  filename: string;
  /** Optional server path where the file was stored */
  path?: string;
}

// ============================================================================
// Agent API Response Types
// ============================================================================

/**
 * Message sent to an agent for chat interaction
 */
export interface ChatMessage {
  /** The message content to send to the agent */
  message: string;
  /** Additional context data for the agent */
  context?: Record<string, any>;
}

/**
 * Response from an agent chat interaction
 */
export interface ChatResponse {
  /** The agent's text response */
  response: string;
  /** Optional array of tool calls made by the agent */
  toolCalls?: Array<{
    /** Name of the tool that was called */
    tool: string;
    /** Arguments passed to the tool */
    args: Record<string, any>;
    /** Result returned from the tool */
    result?: any;
  }>;
}

/**
 * Information about an available agent
 */
export interface AgentInfo {
  /** Name of the agent */
  name: string;
  /** Description of what the agent does */
  description: string;
  /** Tags for categorizing/filtering agents */
  tags: string[];
}

/**
 * Response containing list of available agents
 */
export interface ListAgentsResponse {
  /** Array of available agents */
  agents: AgentInfo[];
}

/**
 * Information about an available strategist pacing interruption.
 */
export interface PacingInterruptionInfo {
  /** Registry key used in PlayerConfig.pacing.interruption */
  name: string;
  /** Human-readable label for config UI controls */
  label: string;
  /** Optional description of when the interruption fires */
  description?: string;
}

/**
 * Response containing registered strategist pacing interruptions.
 */
export interface ListPacingInterruptionsResponse {
  /** Array of available pacing interruption strategies */
  interruptions: PacingInterruptionInfo[];
}

/**
 * Request to create a new chat thread.
 *
 * Two shapes share this endpoint:
 * - **Observer / ordinary chat** (`mode` omitted): the operator picks a `contextId`
 *   (or `databasePath`) — its player becomes the voiced endpoint B — plus a free-form
 *   caller role/affiliation describing endpoint A (`callerRole` / `callerPlayerID`,
 *   the latter `-1`/omitted for the observer).
 * - **Diplomacy** (`mode: 'diplomacy'`): a civ↔civ conversation between two seats.
 *   `targetPlayerID` is the LLM-voiced seat (endpoint B), `initiatorPlayerID` the caller
 *   seat (endpoint A). `agentName` is an optional voice override; when omitted the server
 *   defaults to the target seat's configured diplomat.
 */
export interface CreateChatRequest {
  /** Name of the agent to use. Optional in diplomacy mode (server defaults to the target diplomat). */
  agentName?: string;
  /** Context ID for live sessions (resolves gameID; its player is endpoint B for observer chats). */
  contextId?: string;
  /** Database path for telepathist mode */
  databasePath?: string;
  /** Current game turn */
  turn?: number;

  /** Conversation mode. Omit for ordinary observer/telepathist chat. */
  mode?: 'diplomacy';
  /** Diplomacy: the LLM-voiced target seat (endpoint B). */
  targetPlayerID?: number;
  /** Diplomacy: the initiating caller seat (endpoint A). Defaults to the human-control seat. */
  initiatorPlayerID?: number;
  /** Free-form role of the caller (endpoint A), e.g. "the leader". */
  callerRole?: string;
  /** Caller's player affiliation for an observer/ordinary chat (-1 or omitted = observer). */
  callerPlayerID?: number;
}

/**
 * Display enrichment attached to chat responses. The thread stores only the store-aligned
 * pair (player1/2 + roles + `agent` playerID); the server resolves human-readable civ
 * labels from the live parameters once and attaches them here so the UI need not derive them.
 */
export interface ChatResponseEnrichment {
  /** Current game turn from the live context, for stale-turn / close-lock detection. */
  currentTurn?: number;
  /** PlayerID of the agent-voiced seat (= thread.agent), echoed for convenience. */
  voicedID?: number;
  /** Display name of the voiced civ, e.g. "Bismarck of Germany". */
  voicedCiv?: string;
  /** Display name of the audience civ (the other endpoint), if any. */
  audienceCiv?: string;
}

/**
 * Response after creating a new chat thread: the full EnvoyThread plus display enrichment.
 */
export type CreateChatResponse = EnvoyThread & ChatResponseEnrichment;

/**
 * Response containing list of chat threads
 */
export interface ListChatsResponse {
  /** Array of active chat threads (EnvoyThread objects) */
  chats: EnvoyThread[];
}

/**
 * Response containing a single chat thread with display enrichment.
 */
export type GetChatResponse = EnvoyThread & ChatResponseEnrichment;

/**
 * Request to send a chat message
 */
export interface ChatMessageRequest {
  /** Chat thread ID to send the message to */
  chatId: string;
  /** The message content. Omit for greeting mode (empty thread). */
  message?: string;
}

/**
 * Response after deleting a chat thread
 */
export interface DeleteChatResponse {
  /** Whether the deletion was successful */
  success: boolean;
}

// ============================================================================
// Session Management API Response Types
// ============================================================================

import type { SessionConfig } from './config.js';

/** Session state enumeration */
export type SessionState = 'starting' | 'running' | 'stopping' | 'stopped' | 'recovering' | 'error';

/**
 * Session status information for API responses.
 */
export interface SessionStatus {
  /** Unique session identifier */
  id: string;

  /** Session type (e.g., 'strategist') */
  type: string;

  /** Current session state */
  state: SessionState;

  /** Session configuration */
  config: SessionConfig;

  /** When the session started */
  startTime: Date;

  /** Active VoxContext IDs for telemetry tracking */
  contexts?: string[];

  /** Current game ID */
  gameID?: string;

  /** Current game turn */
  turn?: number;

  /** Error message if state is 'error' */
  error?: string;

  /**
   * Whether the session completed successfully. MCP defers `PlayerVictory`
   * until the game archive is on disk, so observing it is sufficient. Only
   * meaningful once `state === 'stopped'`.
   */
  succeeded?: boolean;
}

/**
 * GET /api/session/status response
 */
export interface SessionStatusResponse {
  /** Whether a session is active */
  active: boolean;
  /** Current session details if active */
  session?: SessionStatus;
}

/**
 * GET /api/session/configs response
 */
export interface SessionConfigsResponse {
  /** Available session configurations */
  configs: SessionConfig[];
}

/**
 * POST /api/session/start request body
 */
export interface StartSessionRequest {
  /** Session configuration object */
  config: SessionConfig;
}

/**
 * POST /api/session/start response
 */
export interface StartSessionResponse {
  /**
   * The new session ID, if a session has been created synchronously. With the
   * shared strategist loop, the first session is built asynchronously after
   * the cycle's seating cell is claimed, so this may be omitted.
   */
  sessionId?: string;
  /** Session status snapshot, if available. Poll `/api/session/status` for the live state. */
  status?: SessionStatus;
}

/**
 * POST /api/session/save request body
 */
export interface SaveSessionConfigRequest {
  /** Filename to save as (without .json extension) */
  filename: string;
  /** Configuration object to save */
  config: SessionConfig;
}

/**
 * POST /api/session/save response
 */
export interface SaveSessionConfigResponse {
  /** Whether the save was successful */
  success: boolean;
  /** Final filename with .json extension */
  filename: string;
  /** Full path to the saved file */
  path: string;
}

/**
 * DELETE /api/session/config/:filename response
 */
export interface DeleteSessionConfigResponse {
  /** Whether the deletion was successful */
  success: boolean;
  /** Success message */
  message: string;
}

/**
 * POST /api/session/stop response
 */
export interface StopSessionResponse {
  /** Whether the stop was successful */
  success: boolean;
  /** Success message */
  message: string;
}

/**
 * GET /api/session/players-summary response
 */
export interface PlayersSummaryResponse {
  /** Players report containing all major player data */
  players: PlayersReport;
  /** Map of actual player ID to their AI assignment (strategist/diplomat/negotiator agents,
   *  their models, and the original config slot). */
  assignments?: Record<number, PlayerAssignment>;
}

/**
 * Per-seat agent assignment, reported by the active session for the players-summary UI
 * and used server-side to resolve the default diplomat voice for a diplomacy conversation.
 */
export interface PlayerAssignment {
  /** Strategist agent name. */
  strategist: string;
  /** Strategist model short name, if overridden. */
  model?: string;
  /** Resolved diplomat agent name (configured `diplomat`, or the built-in default). */
  diplomat?: string;
  /** Diplomat model short name, if overridden. */
  diplomatModel?: string;
  /** Resolved negotiator agent name, if configured (stage 5). */
  negotiator?: string;
  /** Negotiator model short name, if overridden. */
  negotiatorModel?: string;
  /** Original config slot this seat was assigned from. */
  configSlot: number;
}
