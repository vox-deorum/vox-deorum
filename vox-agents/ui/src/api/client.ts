/**
 * API client for communication with the Vox Agents backend
 * Provides methods for REST endpoints and SSE streaming with strong typing
 */

import { SSE } from 'sse.js';
import { extractLogParams } from './log-utils';
import { errorMessage } from '../utils/errors';
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
  ConfigResponse,
  DiscoverModelsRequest,
  DiscoverModelsResponse,
  DiscoveryErrorResponse,
  ConfiguredModelsResponse,
  ConfigCheckResponse,
  CodexLoginResponse,
  CodexStatusResponse,
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
  ChatConnectedEvent,
  ChatDoneEvent,
  DeleteChatResponse,
  ChatMessageRequest,
  // Typed deal-action API (stage 4)
  InspectDealRequest,
  InspectDealResponse,
  DealRejectRequest,
  DealAcceptRequest,
  DealMessagesResponse,
  // Debug page types
  DebugLogFileResponse,
  DebugLogSource,
  DebugStatusResponse,
  SetCivLoggingRequest,
  SetCivLoggingResponse
} from '../utils/types';
import type { TextStreamPart, ToolSet } from 'ai';

/** Categories returned by model discovery so the wizard can explain the next action. */
export type ModelDiscoveryErrorKind = DiscoveryErrorResponse['kind'];

/** Preserve the server's discovery category while retaining a normal Error interface. */
export class ModelDiscoveryError extends Error {
  /** Create a categorized model-discovery failure. */
  constructor(message: string, public readonly kind: ModelDiscoveryErrorKind) {
    super(message);
    this.name = 'ModelDiscoveryError';
  }
}

/** The `connected` SSE event payload: fired post-commit; for a deal turn it carries the committed row. */
type ConnectedData = Omit<ChatConnectedEvent, 'rows'>;

/** The terminal `done` SSE event payload: the turn succeeded. */
type DoneData = Omit<ChatDoneEvent, 'rows'>;

/** Check the fields the UI consumes before accepting a terminal stream payload. */
function isDoneData(value: unknown): value is DoneData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<DoneData>;
  return typeof candidate.sessionId === 'string'
    && typeof candidate.messageCount === 'number'
    && Array.isArray(candidate.deals);
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
    return parsed?.message || parsed?.error || body;
  } catch {
    return body; // not JSON — surface the raw text
  }
}

/** Parse one SSE event and retain each handler's existing parse-error reporting. */
function parseEvent<T>(
  event: MessageEvent,
  parser: (data: string) => T,
  parseLabel: string
): T | undefined {
  try {
    return parser(event.data);
  } catch (error) {
    console.error(`Failed to parse ${parseLabel}:`, error);
    return undefined;
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
    return this.streamEventSource(
      'logs',
      '/api/logs/stream',
      'log',
      (data) => extractLogParams(JSON.parse(data)),
      onMessage,
      'log message',
      onError,
      onHeartbeat,
    );
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
    return this.streamEventSource(
      key,
      `/api/telemetry/sessions/${encodeURIComponent(sessionId)}/stream`,
      'span',
      (data) => JSON.parse(data) as Span[],
      onMessage,
      'span data',
      onError,
      onHeartbeat,
    );
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

    return this.fetchJson<UploadResponse>(`${this.baseUrl}/api/telemetry/upload`, {
      method: 'POST',
      body: formData
    });
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
   * @param gameMode Launch mode selected for this session run
   */
  async startSession(config: SessionConfig, gameMode: StartSessionRequest['gameMode']): Promise<StartSessionResponse> {
    const request: StartSessionRequest = { config, gameMode };
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
  async getCurrentConfig(): Promise<ConfigResponse> {
    return this.fetchJson<ConfigResponse>(
      `${this.baseUrl}/api/config`
    );
  }

  /**
   * Update current configuration (config.json and API keys)
   * @param data Configuration data and API keys to update
   * @returns Success status
   */
  async updateCurrentConfig(data: Partial<ConfigResponse>): Promise<{ success: boolean }> {
    return this.fetchJson<{ success: boolean }>(
      `${this.baseUrl}/api/config`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }
    );
  }

  /** Validate provider credentials and list models available to the current user. */
  async discoverModels(
    provider: string,
    credentials?: Record<string, string>
  ): Promise<DiscoverModelsResponse> {
    const request: DiscoverModelsRequest = { provider, ...(credentials ? { credentials } : {}) };
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/config/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });
    } catch (error) {
      throw new ModelDiscoveryError(
        errorMessage(error, 'The provider could not be reached.'),
        'network'
      );
    }
    if (!response.ok) {
      const fallback = `Request failed: ${response.statusText}`;
      try {
        const failure = await response.json() as DiscoveryErrorResponse;
        throw new ModelDiscoveryError(failure.error || fallback, failure.kind || 'provider');
      } catch (error) {
        if (error instanceof ModelDiscoveryError) throw error;
        throw new ModelDiscoveryError(fallback, 'provider');
      }
    }
    return response.json() as Promise<DiscoverModelsResponse>;
  }

  /** Start the browser-assisted ChatGPT sign-in flow. */
  async startCodexLogin(): Promise<CodexLoginResponse> {
    return this.fetchJson<CodexLoginResponse>(`${this.baseUrl}/api/config/codex/login`, {
      method: 'POST'
    });
  }

  /** Read the current browser-assisted ChatGPT sign-in state. */
  async getCodexLoginStatus(): Promise<CodexStatusResponse> {
    return this.fetchJson<CodexStatusResponse>(`${this.baseUrl}/api/config/codex/status`);
  }

  /** Check whether the installation has a usable onboarding configuration. */
  async checkSetupStatus(): Promise<ConfigCheckResponse> {
    return this.fetchJson<ConfigCheckResponse>(
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
    thread.messages = thread.messages.map((message) => ({
      ...message,
      metadata: { ...message.metadata, datetime: new Date(message.metadata.datetime) }
    }));
    return thread;
  }

  /** Get models that the configured providers can currently reach. */
  async getConfigModels(): Promise<ConfiguredModelsResponse> {
    return this.fetchJson<ConfiguredModelsResponse>(`${this.baseUrl}/api/config/models`);
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
    eventSource.addEventListener('message', (event: MessageEvent) => {
      const data = parseEvent(event, (value) => JSON.parse(value) as TextStreamPart<ToolSet>, 'agent message chunk');
      if (data !== undefined) {
        // The backend sends just the chunk string for message events
        onMessage(data);
      }
    });

    // 'connected' fires once the server has COMMITTED the turn (post-commit), before the reply streams.
    // For a deal turn it carries the authoritative committed row; the caller inserts it and closes the
    // deal dialog here. A pre-stream rejection never reaches this, so the dialog stays open.
    eventSource.addEventListener('connected', (event: MessageEvent) => {
      const data = parseEvent(event, (value) => JSON.parse(value) as ConnectedData, 'connected event');
      if (data !== undefined) onConnected?.(data);
    });

    // Listen for 'done' events. The terminal payload carries any deal rows the diplomat's tools wrote
    // mid-run (reconciled server-side); parse it so the caller can splice them in without a reload.
    eventSource.addEventListener('done', (event: MessageEvent) => {
      const data = parseEvent(event, (value) => {
        const parsed: unknown = JSON.parse(value);
        if (!isDoneData(parsed)) throw new Error('Invalid done event payload.');
        return parsed;
      }, 'done event');
      if (data === undefined) {
        fail({ data: JSON.stringify({ message: 'The terminal response from the server was invalid.' }) });
        return;
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

  // ============= Debug API Methods =============

  /** List log files per source and read whether Civ 5 logging is on. */
  async getDebugStatus(): Promise<DebugStatusResponse> {
    return this.fetchJson<DebugStatusResponse>(`${this.baseUrl}/api/debug/status`);
  }

  /** Turn Civ 5's own logging on or off. Takes effect the next time Civ 5 starts. */
  async setCivLogging(enabled: boolean): Promise<SetCivLoggingResponse> {
    const request: SetCivLoggingRequest = { enabled };
    return this.fetchJson<SetCivLoggingResponse>(`${this.baseUrl}/api/debug/civ-logging`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
  }

  /** Read the newest part of one log file. */
  async getLogFile(source: DebugLogSource, name: string): Promise<DebugLogFileResponse> {
    return this.fetchJson<DebugLogFileResponse>(
      `${this.baseUrl}/api/debug/logs/${encodeURIComponent(source)}/${encodeURIComponent(name)}`
    );
  }

  /** Link that downloads every log plus a setup summary as one zip. */
  get debugBundleUrl(): string {
    return `${this.baseUrl}/api/debug/bundle`;
  }

  // ============= Utility Methods =============

  /**
   * Open one native EventSource stream with shared replacement, parsing, heartbeat, error,
   * registration, and cleanup behavior.
   */
  private streamEventSource<T>(
    key: string,
    path: string,
    eventName: string,
    parse: (data: string) => T,
    onMessage: (message: T) => void,
    parseLabel: string,
    onError?: (error: Event) => void,
    onHeartbeat?: () => void,
  ): () => void {
    this.closeSseConnection(key);
    const eventSource = new EventSource(`${this.baseUrl}${path}`);
    eventSource.addEventListener(eventName, (event: MessageEvent) => {
      const data = parseEvent(event, parse, parseLabel);
      if (data !== undefined) onMessage(data);
    });
    eventSource.addEventListener('heartbeat', () => onHeartbeat?.());
    eventSource.onerror = (error) => onError?.(error);
    this.sseConnections.set(key, eventSource);
    return () => this.closeSseConnection(key);
  }

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
