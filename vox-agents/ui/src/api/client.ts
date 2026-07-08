/**
 * API client for communication with the Vox Agents backend
 * Provides methods for REST endpoints and SSE streaming with strong typing
 */

import { SSE } from 'sse.js';
import { extractLogParams } from './log-utils';
import type {
  HealthStatus,
  LogEntry,
  TelemetryDatabasesResponse,
  TelemetrySessionsResponse,
  SessionSpansResponse,
  DatabaseTracesResponse,
  TraceSpansResponse,
  // Session management types
  SessionStatusResponse,
  SessionConfigsResponse,
  StartSessionRequest,
  StartSessionResponse,
  SaveSessionConfigRequest,
  SaveSessionConfigResponse,
  DeleteSessionConfigResponse,
  StopSessionResponse,
  PauseSessionResponse,
  ResumeSessionResponse,
  PlayersSummaryResponse,
  SessionConfig,
  // Config types
  ErrorResponse,
  UploadResponse,
  Span,
  // Agent chat types
  ListAgentsResponse,
  ListPacingInterruptionsResponse,
  CreateChatRequest,
  CreateChatResponse,
  ListChatsResponse,
  GetChatResponse,
  DeleteChatResponse,
  ChatMessageRequest,
  // Typed deal-action API (stage 4)
  InspectDealRequest,
  InspectDealResponse,
  DealRejectRequest,
  DealAcceptRequest,
  DealMessagesResponse,
  DealTranscriptMessage,
  MessageWithMetadata
} from '../utils/types';
import type { TextStreamPart, ToolSet } from 'ai';

/** The `connected` SSE event payload: fired post-commit; for a deal turn it carries the committed row. */
export interface ConnectedData {
  sessionId?: string;
  /** The authoritative committed deal row (deal turns only) — the UI inserts it and closes the dialog. */
  deal?: DealTranscriptMessage;
}

/** The terminal `done` SSE event payload: the turn succeeded. */
export interface DoneData {
  sessionId?: string;
  messageCount?: number;
  /**
   * Deal rows the diplomat's negotiator tools wrote mid-run (counter/accept/reject/enacted), reconciled
   * from the durable store so the board reflects the diplomat's outcome without a reload that would
   * flatten the streamed reasoning/tool traces. Absent/empty when the diplomat wrote no deal rows.
   */
  deals?: DealTranscriptMessage[];
}

/**
 * Where a failed send leaves the durable record, so the UI knows whether retrying is safe:
 * - 'uncommitted': the stream never opened (a pre-stream rejection — unavailable turn, closed
 *   conversation, a 502 on the caller append…), so nothing was written; the host can roll the
 *   optimistic rows fully back and restore the input for a clean retry.
 * - 'committed': the stream had already opened, so the caller's message may be on the record; the
 *   host keeps it and drops only the unfinished reply, since resending could duplicate a committed
 *   utterance. (The name reflects the safe assumption, not certainty — an ambiguous drop counts here.)
 */
export type SendCommitState = 'uncommitted' | 'committed';

/**
 * Normalize whatever an `sse.js` 'error' event carries into one human-readable line. A server-sent
 * error event and a non-2xx POST response both stash their JSON body in `event.data`; a bare
 * connection drop has none. We accept the `{ message }` shape our own SSE error events use, the
 * `{ error }` shape every route's JSON rejection uses, and a plain JSON-string payload.
 */
function streamErrorMessage(event: any): string {
  const body = event?.data;
  if (typeof body !== 'string' || !body) return 'The connection to the server was lost.';
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === 'string') return parsed;
    return parsed?.message || parsed?.error || body;
  } catch {
    return body; // not JSON — surface the raw text
  }
}

/**
 * API client for managing communication with the Vox Agents backend server.
 * Handles both REST API calls and Server-Sent Events (SSE) streaming connections.
 *
 * Features:
 * - Health status monitoring
 * - Real-time log streaming
 * - Telemetry data access and streaming
 * - Session management and event streaming
 * - Agent interaction and chat messaging
 * - Configuration management
 * - Automatic SSE connection cleanup
 * - Strong TypeScript typing for all methods
 */
class ApiClient {
  private baseUrl: string;
  /** Map of active SSE connections indexed by unique keys */
  private sseConnections: Map<string, EventSource | SSE> = new Map();

  constructor() {
    // In production, use same origin. In dev, use Vite proxy or configured port
    this.baseUrl = import.meta.env.PROD ? '' : 'http://localhost:5555';
  }

  /**
   * Generic fetch wrapper with error handling and strong typing
   */
  private async fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options);
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Request failed: ${response.statusText}`;
      try {
        const error: ErrorResponse = JSON.parse(errorText);
        errorMessage = error.error || errorMessage;
      } catch {
        // If not JSON, use the text directly
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }
    return response.json();
  }

  /**
   * Fetch health status from the server
   */
  async getHealth(): Promise<HealthStatus> {
    return this.fetchJson<HealthStatus>(`${this.baseUrl}/api/health`);
  }

  /**
   * Stream logs via Server-Sent Events
   * @param onMessage - Callback for each log entry
   * @param onError - Callback for errors
   * @param onHeartbeat - Callback for heartbeat events
   * @returns Cleanup function to close the connection
   */
  streamLogs(
    onMessage: (log: LogEntry) => void,
    onError?: (error: Event) => void,
    onHeartbeat?: () => void
  ): () => void {
    // Close existing connection if any
    this.closeSseConnection('logs');

    const eventSource = new EventSource(`${this.baseUrl}/api/logs/stream`);

    eventSource.addEventListener("log", (event: MessageEvent) => {
      try {
        const rawLog = JSON.parse(event.data);
        const processedLog = extractLogParams(rawLog);
        onMessage(processedLog);
      } catch (error) {
        console.error('Failed to parse log message:', error);
      }
    });

    eventSource.addEventListener("heartbeat", () => {
      onHeartbeat?.();
    });

    eventSource.onerror = (error) => {
      if (onError) onError(error);
    };

    // Store connection for cleanup
    this.sseConnections.set('logs', eventSource);

    // Return cleanup function
    return () => {
      this.closeSseConnection('logs');
    };
  }

  // ============= Telemetry API Methods =============

  /**
   * Get list of telemetry databases
   */
  async getTelemetryDatabases(): Promise<TelemetryDatabasesResponse> {
    return this.fetchJson<TelemetryDatabasesResponse>(
      `${this.baseUrl}/api/telemetry/databases`
    );
  }

  /**
   * Get active telemetry sessions
   */
  async getTelemetrySessions(): Promise<TelemetrySessionsResponse> {
    return this.fetchJson<TelemetrySessionsResponse>(
      `${this.baseUrl}/api/telemetry/sessions/active`
    );
  }

  /**
   * Get spans for an active session
   */
  async getSessionSpans(sessionId: string): Promise<SessionSpansResponse> {
    return this.fetchJson<SessionSpansResponse>(
      `${this.baseUrl}/api/telemetry/sessions/${encodeURIComponent(sessionId)}/spans`
    );
  }

  /**
   * Stream spans for an active session via SSE
   * @param sessionId - The session ID to stream
   * @param onMessage - Callback for span data
   * @param onError - Callback for errors
   * @param onHeartbeat - Callback for heartbeat events
   * @returns Cleanup function to close the connection
   */
  streamSessionSpans(
    sessionId: string,
    onMessage: (data: Span[]) => void,
    onError?: (error: Event) => void,
    onHeartbeat?: () => void
  ): () => void {
    const key = `session-${sessionId}`;
    this.closeSseConnection(key);

    const eventSource = new EventSource(
      `${this.baseUrl}/api/telemetry/sessions/${encodeURIComponent(sessionId)}/stream`
    );

    eventSource.addEventListener("span", (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch (error) {
        console.error('Failed to parse span data:', error);
      }
    });

    eventSource.addEventListener("heartbeat", () => {
      onHeartbeat?.();
    });

    eventSource.onerror = (error) => {
      if (onError) onError(error);
    };

    this.sseConnections.set(key, eventSource);
    return () => this.closeSseConnection(key);
  }

  /**
   * Get traces from a database
   * @param filename - Database filename (can include folder path)
   * @param limit - Maximum number of traces to return
   * @param offset - Number of traces to skip
   */
  async getDatabaseTraces(
    filename: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<DatabaseTracesResponse> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString()
    });
    return this.fetchJson<DatabaseTracesResponse>(
      `${this.baseUrl}/api/telemetry/db/${encodeURIComponent(filename)}/traces?${params}`
    );
  }

  /**
   * Get all spans for a specific trace
   * @param filename - Database filename (can include folder path)
   * @param traceId - The trace ID to get spans for
   */
  async getTraceSpans(
    filename: string,
    traceId: string
  ): Promise<TraceSpansResponse> {
    return this.fetchJson<TraceSpansResponse>(
      `${this.baseUrl}/api/telemetry/db/${encodeURIComponent(filename)}/trace/${encodeURIComponent(traceId)}/spans`
    );
  }

  /**
   * Upload a telemetry database file
   * @param file - The database file to upload
   */
  async uploadDatabase(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('database', file);

    const response = await fetch(`${this.baseUrl}/api/telemetry/upload`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Upload failed';
      try {
        const error: ErrorResponse = JSON.parse(errorText);
        errorMessage = error.error || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }

    return response.json();
  }

  // ============= Session API Methods =============

  /**
   * Get current session status
   */
  async getSessionStatus(): Promise<SessionStatusResponse> {
    return this.fetchJson<SessionStatusResponse>(`${this.baseUrl}/api/session/status`);
  }

  /**
   * Get list of available session configuration files
   */
  async getSessionConfigs(): Promise<SessionConfigsResponse> {
    return this.fetchJson<SessionConfigsResponse>(`${this.baseUrl}/api/session/configs`);
  }

  /**
   * Start a new session with configuration
   * @param config Full session configuration object
   */
  async startSession(config: SessionConfig): Promise<StartSessionResponse> {
    const request: StartSessionRequest = { config };
    return this.fetchJson<StartSessionResponse>(`${this.baseUrl}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
  }

  /**
   * Save a session configuration to file
   * @param filename Name to save the config as (without .json extension)
   * @param config Configuration object to save
   */
  async saveSessionConfig(filename: string, config: SessionConfig): Promise<SaveSessionConfigResponse> {
    const request: SaveSessionConfigRequest = { filename, config };
    return this.fetchJson<SaveSessionConfigResponse>(`${this.baseUrl}/api/session/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
  }

  /**
   * Delete a saved session configuration file
   * @param filename Config filename to delete (with or without .json extension)
   */
  async deleteSessionConfig(filename: string): Promise<DeleteSessionConfigResponse> {
    return this.fetchJson<DeleteSessionConfigResponse>(
      `${this.baseUrl}/api/session/config/${encodeURIComponent(filename)}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Stop the current session
   */
  async stopSession(): Promise<StopSessionResponse> {
    return this.fetchJson<StopSessionResponse>(`${this.baseUrl}/api/session/stop`, {
      method: 'POST'
    });
  }

  /**
   * Pause the current session (no new LLM runs; the game stalls in place)
   */
  async pauseSession(): Promise<PauseSessionResponse> {
    return this.fetchJson<PauseSessionResponse>(`${this.baseUrl}/api/session/pause`, {
      method: 'POST'
    });
  }

  /**
   * Resume a paused session
   */
  async resumeSession(): Promise<ResumeSessionResponse> {
    return this.fetchJson<ResumeSessionResponse>(`${this.baseUrl}/api/session/resume`, {
      method: 'POST'
    });
  }

  /**
   * Get player summaries for the active session
   */
  async getPlayersSummary(): Promise<PlayersSummaryResponse> {
    return this.fetchJson<PlayersSummaryResponse>(`${this.baseUrl}/api/session/players-summary`);
  }

  // ============= Global Config API Methods =============

  /**
   * Get current configuration (config.json and API keys)
   * @returns Current configuration and API keys
   */
  async getCurrentConfig(): Promise<{ config: any; apiKeys: Record<string, string> }> {
    return this.fetchJson<{ config: any; apiKeys: Record<string, string> }>(
      `${this.baseUrl}/api/config`
    );
  }

  /**
   * Update current configuration (config.json and API keys)
   * @param data Configuration data and API keys to update
   * @returns Success status
   */
  async updateCurrentConfig(data: { config?: any; apiKeys?: Record<string, string> }): Promise<{ success: boolean }> {
    return this.fetchJson<{ success: boolean }>(
      `${this.baseUrl}/api/config`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }
    );
  }

  /**
   * Check if .env file exists
   * @returns Object with exists boolean
   */
  async checkEnvFile(): Promise<{ exists: boolean }> {
    return this.fetchJson<{ exists: boolean }>(
      `${this.baseUrl}/api/config/check`
    );
  }

  // ============= Agent API Methods =============

  /**
   * Get list of available agents
   */
  async getAgents(): Promise<ListAgentsResponse> {
    return this.fetchJson<ListAgentsResponse>(
      `${this.baseUrl}/api/agents`
    );
  }

  /**
   * Get registered strategist pacing interruption strategies
   */
  async getPacingInterruptions(): Promise<ListPacingInterruptionsResponse> {
    return this.fetchJson<ListPacingInterruptionsResponse>(
      `${this.baseUrl}/api/agents/pacing-interruptions`
    );
  }

  /**
   * Create a new agent chat thread
   */
  async createAgentChat(request: CreateChatRequest): Promise<CreateChatResponse> {
    return this.fetchJson<CreateChatResponse>(
      `${this.baseUrl}/api/agents/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      }
    );
  }

  /**
   * Get all agent chat threads
   */
  async getAgentChats(): Promise<ListChatsResponse> {
    return this.fetchJson<ListChatsResponse>(
      `${this.baseUrl}/api/agents/chats`
    );
  }

  /**
   * Normalize a fetched thread's message datetimes to real `Date` objects. Server-hydrated
   * history arrives with `metadata.datetime` as an ISO string (a `Date` serialized over HTTP);
   * revive it here — at the deserialization seam — so callers always see `Date`s (and the `deal`
   * payload and every other field are preserved via the spread).
   */
  private reviveThreadDates(thread: GetChatResponse): GetChatResponse {
    if (Array.isArray(thread?.messages)) {
      thread.messages = thread.messages.map((m: MessageWithMetadata) =>
        m.metadata?.datetime instanceof Date
          ? m
          : { ...m, metadata: { ...m.metadata, datetime: new Date(m.metadata.datetime) } }
      );
    }
    return thread;
  }

  /**
   * Get a specific agent chat thread
   */
  async getAgentChat(chatId: string): Promise<GetChatResponse> {
    return this.reviveThreadDates(await this.fetchJson<GetChatResponse>(
      `${this.baseUrl}/api/agents/chat/${encodeURIComponent(chatId)}`
    ));
  }

  /**
   * Delete an agent chat thread
   */
  async deleteAgentChat(chatId: string): Promise<DeleteChatResponse> {
    return this.fetchJson<DeleteChatResponse>(
      `${this.baseUrl}/api/agents/chat/${encodeURIComponent(chatId)}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Close a diplomacy conversation. Writes the `close` special message and locks the
   * conversation for the rest of the current turn. Returns the updated thread.
   */
  async closeAgentChat(chatId: string, message?: string): Promise<GetChatResponse> {
    return this.reviveThreadDates(await this.fetchJson<GetChatResponse>(
      `${this.baseUrl}/api/agents/chat/${encodeURIComponent(chatId)}/close`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      }
    ));
  }

  // ============= Typed Deal-Action API (interactive-diplomacy stage 4) =============

  /**
   * Inspect a (possibly empty) deal against live game state. Omit `deal` to get the
   * tradable range only; pass a constructed deal for per-term legality + value estimates
   * and per-promise agreeability. Used for the initial trade screen and for live
   * re-evaluation as the human edits the deal. Advisory only — it gates nothing.
   */
  async inspectDeal(chatId: string, request: InspectDealRequest = {}): Promise<InspectDealResponse> {
    return this.fetchJson<InspectDealResponse>(
      `${this.baseUrl}/api/agents/chat/${encodeURIComponent(chatId)}/deal/inspect`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      }
    );
  }

  // Presenting (deal-proposal) and countering (deal-counter) a deal are NOT separate calls: they go
  // through `streamAgentMessage` with a `deal` body (the unified streaming chat path), so the
  // diplomat's reply streams asynchronously like a chat reply instead of blocking on the round-trip.

  /**
   * Reject (decline or retract) a proposal by the message ID it answers (deal-reject).
   * Returns the updated thread (the proposal now reduces to rejected) — a status flip mirrors
   * the new row into the conversation rather than re-fetching/replacing it.
   */
  async rejectDeal(chatId: string, request: DealRejectRequest): Promise<GetChatResponse> {
    return this.reviveThreadDates(await this.fetchJson<GetChatResponse>(
      `${this.baseUrl}/api/agents/chat/${encodeURIComponent(chatId)}/deal/reject`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      }
    ));
  }

  /**
   * Accept a proposal, routing through enactment (the sole writer of deal-accept / deal-enacted).
   * Returns the updated thread with the deal-accept / deal-enacted rows mirrored in (the proposal
   * now reduces to enacted), preserving the conversation's existing reasoning/tool-call traces.
   */
  async acceptDeal(chatId: string, request: DealAcceptRequest): Promise<GetChatResponse> {
    return this.reviveThreadDates(await this.fetchJson<GetChatResponse>(
      `${this.baseUrl}/api/agents/chat/${encodeURIComponent(chatId)}/deal/accept`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      }
    ));
  }

  /**
   * List the conversation's deal messages (proposal/counter/accept/reject/enacted) in
   * append order, for client-side reduction into the latest active proposal.
   */
  async getDealMessages(chatId: string): Promise<DealMessagesResponse> {
    return this.fetchJson<DealMessagesResponse>(
      `${this.baseUrl}/api/agents/chat/${encodeURIComponent(chatId)}/deals`
    );
  }

  /**
   * Send a message to an agent and stream the response
   */
  streamAgentMessage(
    request: ChatMessageRequest,
    onMessage: (data: TextStreamPart<ToolSet>) => void,
    onError: (message: string, commit: SendCommitState) => void,
    onDone: (data: DoneData) => void,
    onConnected?: (data: ConnectedData) => void
  ): () => void {
    const key = `agent-chat-${request.chatId}`;
    this.closeSseConnection(key);

    const url = `${this.baseUrl}/api/agents/message`;

    // Create SSE connection with POST request
    const eventSource = new SSE(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify(request),
      withCredentials: false
    });

    // Listen for 'message' events (streaming chunks)
    eventSource.addEventListener('message', (event: any) => {
      try {
        const data = JSON.parse(event.data);
        // The backend sends just the chunk string for message events
        onMessage(data);
      } catch (error) {
        console.error('Failed to parse agent message chunk:', error);
      }
    });

    // 'connected' fires once the server has COMMITTED the turn (post-commit), before the reply streams.
    // For a deal turn it carries the authoritative committed row; the caller inserts it and closes the
    // deal dialog here. A pre-stream rejection never reaches this, so the dialog stays open.
    eventSource.addEventListener('connected', (event: any) => {
      try {
        onConnected?.(JSON.parse(event.data));
      } catch (error) {
        console.error('Failed to parse connected event:', error);
      }
    });

    // Listen for 'done' events. The terminal payload carries any deal rows the diplomat's tools wrote
    // mid-run (reconciled server-side); parse it so the caller can splice them in without a reload.
    eventSource.addEventListener('done', (event: any) => {
      let data: DoneData = {};
      try {
        if (event?.data) data = JSON.parse(event.data);
      } catch (error) {
        console.error('Failed to parse done event:', error);
      }
      onDone(data);
    });

    // Surface a stream failure exactly once, with a `SendCommitState` telling the caller whether a retry
    // is safe. sse.js dispatches a single 'error' event to BOTH `onerror` and every
    // `addEventListener('error')` listener, so the `failed` guard collapses the two bubbles into one. A
    // non-2xx response to the POST (the route's pre-stream JSON rejections: 400/404/409/502/503) carries
    // `event.responseCode` and means the send never took effect → 'uncommitted'; any other terminal
    // failure (a server-sent error event or a bare drop, no responseCode) arrives only after the stream
    // opened, when the caller's message may already be on the record → 'committed'.
    let failed = false;
    const fail = (event: any) => {
      if (failed) return;
      failed = true;
      const message = streamErrorMessage(event);
      const commit: SendCommitState =
        typeof event?.responseCode === 'number' && event.responseCode >= 400 ? 'uncommitted' : 'committed';
      console.error('SSE error:', message);
      onError(message, commit);
    };
    eventSource.addEventListener('error', fail);
    eventSource.onerror = fail;

    // Start the connection
    eventSource.stream();

    // Store the connection for cleanup
    this.sseConnections.set(key, eventSource);

    // Return cleanup function
    return () => this.closeSseConnection(key);
  }

  // ============= Utility Methods =============

  /**
   * Close a specific SSE connection
   */
  private closeSseConnection(key: string): void {
    const connection = this.sseConnections.get(key);
    if (connection) {
      connection.close();
      this.sseConnections.delete(key);
    }
  }

  /**
   * Close all SSE connections
   */
  closeAllConnections(): void {
    this.sseConnections.forEach((connection) => {
      connection.close();
    });
    this.sseConnections.clear();
  }
}

// Export singleton instance
export const api = new ApiClient();

// Also export as apiClient for backward compatibility
export const apiClient = api;
