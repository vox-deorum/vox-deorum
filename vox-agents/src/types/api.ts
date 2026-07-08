/**
 * @module types/api
 *
 * API response types for Vox Agents.
 * Contains all types for HTTP endpoint responses and requests.
 */

import type { Span, TelemetryMetadata, TelemetrySession } from './telemetry.js';
import type { EnvoyThread, ParticipantIdentity } from './chat.js';
import type { PlayersReport } from '../../../mcp-server/dist/tools/knowledge/get-players.js';
// Pinned deal contract shared across interactive-diplomacy stages 4–6.
import type { DealPayload, DealTranscriptMessage } from '../../../mcp-server/dist/utils/deal-schema.js';

// Re-export types that are used in API responses
export type { PlayersReport };
export type { DealPayload, TradeItem, PromiseTerm, PerItemValueMap, DealMessagePayload, DealTranscriptMessage } from '../../../mcp-server/dist/utils/deal-schema.js';
// The enriched `inspect-deal` result shape is owned by the tool (interactive-diplomacy stage 4);
// re-export it (and its normalized range / candidate / promise-target types) verbatim so the Web
// deal board consumes the same explicit interfaces the tool returns rather than loose records.
export type {
  InspectDealResponse,
  InspectedTradeItem,
  InspectedPromise,
  NormalizedSideRange,
  CandidateLegality,
  NormalizedResourceCandidate,
  NormalizedCityCandidate,
  NormalizedTechCandidate,
  NormalizedThirdPartyCandidate,
  NormalizedVoteCommitmentCandidate,
  PromiseTargetInfo,
} from '../../../mcp-server/dist/tools/knowledge/inspect-deal.js';

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
 * Information about an available agent
 */
export interface AgentInfo {
  /** Name of the agent */
  name: string;
  /** Description of what the agent does */
  description: string;
  /** Tags for categorizing/filtering agents */
  tags: string[];
  /** When true, this agent only operates in diplomacy mode (no ordinary observer/telepathist chat). */
  diplomacyOnly?: boolean;
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
 *   `targetPlayerID` is the LLM-voiced seat (endpoint B); the audience seat (endpoint A) is
 *   described by the shared `caller*` fields. `agentName` is an optional voice override; when
 *   omitted the server defaults to the target seat's configured diplomat.
 *
 * The audience / endpoint A is always described by the `caller*` fields (`callerRole`,
 * `callerPlayerID`, `callerIdentity`) regardless of mode — there is no separate "initiator".
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
  /**
   * Diplomacy: the voiced (endpoint B) seat's civ+leader, supplied by the dialog from its
   * non-FOW player summary. Like `callerIdentity`, this is the authoritative source: the target
   * seat's live context can carry a FOW-limited (or empty) players map, so re-resolving its civ
   * server-side can yield undefined and leave the thread/title showing a bare "Player N". When
   * omitted the server falls back to the live lookup off the target context.
   */
  targetIdentity?: ParticipantIdentity;

  /** Free-form role of the caller / audience (endpoint A), e.g. "the leader". Shared by both modes. */
  callerRole?: string;
  /**
   * The caller / audience seat (endpoint A). Observer chat: `-1`/omitted = the observer.
   * Diplomacy: a real seat; when omitted the server defaults to the human-control seat.
   */
  callerPlayerID?: number;
  /**
   * The audience (endpoint A) seat's civ+leader, supplied by the dialog from its non-FOW player
   * summary. The authoritative source: the voiced seat may not have met the audience, so it
   * cannot be reliably re-resolved server-side from game state. For an observer it carries the
   * dialog's hardcoded observer identity.
   */
  callerIdentity?: ParticipantIdentity;
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
 * A plain-text chat turn for the unified `/api/agents/message` streaming route. Also carries the
 * `{{{Greeting}}}` trigger (an agent-initiated reply on an empty/stale thread) as its `message`.
 */
export interface TextMove {
  kind: 'text';
  /** Chat thread ID to send the message to. */
  chatId: string;
  /** The utterance to commit, or the `{{{Greeting}}}` trigger. */
  message: string;
}

/**
 * A structured deal turn committed as the turn's commit point (diplomacy threads only). Proposing and
 * countering are ONE action — submitting a deal — so there is no `propose`/`counter` flag: the server
 * derives the archival type (`deal-proposal` vs `deal-counter`) from the live offer state. The route
 * computes value snapshots + durations server-side and streams the diplomat's reply identically for
 * both; the transcript Content is derived server-side from `deal.message` (no separate field).
 */
export interface DealMove {
  kind: 'deal';
  /** Chat thread ID to send the deal to. */
  chatId: string;
  /** Structured deal to commit this turn (its `message` becomes the proposal's transcript Content). */
  deal: DealPayload;
  /**
   * The submitter's view of the open offer it is answering: the ID of the proposal currently on the
   * table, or `undefined` when it believes none is open (a fresh proposal). The commit reconciles this
   * against the live state under the per-thread turn lock — it MUST match the actual active open offer
   * (or its actual absence). So a stale/fresh submission can't silently supersede an offer that opened
   * under it, and a stale counter can't revive a rejected/countered/closed one (either mismatch is a 409).
   */
  expectedProposalID?: number;
}

/**
 * Request to send a chat message OR commit a deal proposal/counter as the turn's commit point.
 *
 * A `kind`-discriminated union: a turn is EITHER a plain-text utterance (`text`) or a structured
 * `deal`, never both. The unified `/api/agents/message` streaming route commits the caller's move
 * accordingly, then streams the diplomat's reply identically for both. `beginChatTurn` reuses this
 * exact union as its `TurnCommit` (ignoring `chatId`), so there's one shape end-to-end.
 */
export type ChatMessageRequest = TextMove | DealMove;

/**
 * Response after deleting a chat thread
 */
export interface DeleteChatResponse {
  /** Whether the deletion was successful */
  success: boolean;
}

// ============================================================================
// Typed deal-action API (interactive-diplomacy stage 4)
//
// The BLOCKING structured deal endpoints — inspect / reject / accept / deals — each under
// `/api/agents/chat/:chatId/deal/*`, returning the updated thread with no streamed reply. Proposal &
// counter are NOT here: they commit + stream the diplomat's reply through the unified
// `/api/agents/message` path (a `deal` body, see DealMove). The human may reject or retract;
// acceptance routes through the enactment route, which enacts the deal in-game.
// ============================================================================

/**
 * Request to inspect a (possibly empty) deal against live game state. Omit `deal` to get
 * the tradable range only; pass a constructed deal for per-term legality + value and
 * per-promise agreeability. Everything returned is advisory (specs §4).
 */
export interface InspectDealRequest {
  /** Optional constructed deal to evaluate; omit for the tradable range only. */
  deal?: DealPayload;
}

/** Request to reject (decline or retract) an earlier proposal/counter by its message ID. */
export interface DealRejectRequest {
  proposalMessageID: number;
  content?: string;
}

/** Request to accept an earlier proposal; acceptance enacts the deal in-game via the enactment route. */
export interface DealAcceptRequest {
  proposalMessageID: number;
}

/** Response listing a conversation's deal messages in append order, for reduction. */
export interface DealMessagesResponse {
  messages: DealTranscriptMessage[];
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

  /**
   * Whether the session is paused. Orthogonal to `state` (which stays
   * `'running'` while paused): the agent loops are held in place, so no new LLM
   * runs start and the game stalls, but nothing is aborted.
   */
  paused?: boolean;
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
 * POST /api/session/pause response
 */
export interface PauseSessionResponse {
  /** Whether the pause was applied */
  success: boolean;
  /** Success message */
  message: string;
  /** Resulting paused state (echoed so the UI can reconcile immediately) */
  paused: boolean;
}

/**
 * POST /api/session/resume response
 */
export interface ResumeSessionResponse {
  /** Whether the resume was applied */
  success: boolean;
  /** Success message */
  message: string;
  /** Resulting paused state (echoed so the UI can reconcile immediately) */
  paused: boolean;
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
