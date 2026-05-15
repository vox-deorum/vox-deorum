/**
 * @module types/api
 *
 * API response types for Vox Agents.
 * Contains all types for HTTP endpoint responses and requests.
 */

import type { Span, TelemetryMetadata, TelemetrySession } from './telemetry.js';
import type { EnvoyThread, UserIdentity } from './chat.js';
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
 * Request to create a new chat thread
 */
export interface CreateChatRequest {
  /** Name of the agent to use */
  agentName: string;
  /** Context ID for live sessions */
  contextId?: string;
  /** Database path for telepathist mode */
  databasePath?: string;
  /** Current game turn */
  turn?: number;
  /** User's identity for the conversation */
  userIdentity?: UserIdentity;
}

/**
 * Response after creating a new chat thread
 * Returns the full EnvoyThread object
 */
export type CreateChatResponse = EnvoyThread;

/**
 * Response containing list of chat threads
 */
export interface ListChatsResponse {
  /** Array of active chat threads (EnvoyThread objects) */
  chats: EnvoyThread[];
}

/**
 * Response containing a single chat thread with optional current game turn
 */
export type GetChatResponse = EnvoyThread & {
  /** Current game turn from the live context, for stale-turn detection */
  currentTurn?: number;
};

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
   * Whether the session completed successfully (victory was observed AND
   * MCP archival was confirmed). Only meaningful once `state === 'stopped'`.
   */
  succeeded?: boolean;

  /**
   * Whether the MCP `GameArchived` notification reported success for the
   * most recent game. Mirrors the archive outcome that gated `succeeded`.
   */
  archived?: boolean;
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
  /** The new session ID */
  sessionId: string;
  /** Session status */
  status: SessionStatus;
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
  /** Map of actual player ID to their AI assignment (strategist type, model, and original config slot) */
  assignments?: Record<number, { strategist: string; model?: string; configSlot: number }>;
}