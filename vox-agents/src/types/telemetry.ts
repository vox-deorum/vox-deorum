/**
 * @module types/telemetry
 *
 * OpenTelemetry and telemetry-related types for Vox Agents.
 * Contains span definitions, telemetry metadata, and session types.
 */

/**
 * Metadata for a telemetry database file containing game session data
 */
export interface TelemetryMetadata {
  /** Folder path containing the database */
  folder: string;
  /** Database filename */
  filename: string;
  /** Unique game session identifier */
  gameID: string;
  /** Player identifier for the session */
  playerID: string;
  /** Database file size in bytes */
  size: number;
  /** ISO timestamp of last modification */
  lastModified: string;
  /** Whether a seat workspace store exists for this game and player */
  hasWorkspace: boolean;
}

/**
 * Represents an active telemetry session
 */
export interface TelemetrySession {
  /** The session identifier */
  sessionId: string;
  /** Extracted game ID if available */
  gameID?: string;
  /** Extracted player ID if available */
  playerID?: string;
}

/**
 * Flexible key-value attributes for OpenTelemetry spans
 */
export interface SpanAttributes {
  /** Any additional attributes as key-value pairs */
  [key: string]: any;
}

/**
 * Represents an OpenTelemetry span (a unit of work in a distributed trace)
 */
export interface Span {
  /** Optional database row ID */
  id?: number;
  /** Session context identifier */
  contextId: string;
  /** Game turn number when the span was created, null if not during a turn */
  turn: number | null;
  /** Unique trace identifier (groups related spans) */
  traceId: string;
  /** Unique span identifier */
  spanId: string;
  /** Parent span ID for hierarchical traces, null for root spans */
  parentSpanId: string | null;
  /** Human-readable name describing the operation */
  name: string;
  /** Unix timestamp (nanoseconds) when the span started */
  startTime: number;
  /** Unix timestamp (nanoseconds) when the span ended */
  endTime: number;
  /** Duration of the operation in milliseconds */
  durationMs: number;
  /** Additional metadata and context for the span */
  attributes: SpanAttributes;
  /** Status code (0 = OK, 1 = ERROR) */
  statusCode: number;
  /** Optional status message providing error details */
  statusMessage: string | null;
}