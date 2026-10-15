/**
 * @module utils/telemetry/schema
 *
 * Database schema definitions for telemetry data using Kysely.
 * Defines TypeScript interfaces for type-safe database operations.
 */

import type { Generated, Insertable, Selectable, Updateable, JSONColumnType } from 'kysely';

/**
 * Parsed span attributes type
 */
export interface SpanAttributes {
  [key: string]: any;
}

/**
 * Represents a telemetry span record in the database
 */
export interface SpanRecord {
  /**
   * Auto-incrementing primary key
   */
  id: Generated<number>;

  /**
   * VoxContext ID for grouping related spans
   */
  contextId: string;

  /**
   * Game turn number extracted from span attributes
   */
  turn: number | null;

  /**
   * OpenTelemetry trace ID (hex string)
   */
  traceId: string;

  /**
   * OpenTelemetry span ID (hex string)
   */
  spanId: string;

  /**
   * Parent span ID for hierarchy (hex string, nullable for root spans)
   */
  parentSpanId: string | null;

  /**
   * Human-readable span name describing the operation
   */
  name: string;

  /**
   * Start time in nanoseconds since Unix epoch
   */
  startTime: number;

  /**
   * End time in nanoseconds since Unix epoch
   */
  endTime: number;

  /**
   * Duration in milliseconds for quick queries
   */
  durationMs: number;

  /**
   * JSON-encoded attributes (excluding vox.context.id and turn)
   */
  attributes: JSONColumnType<SpanAttributes> | null;

  /**
   * OpenTelemetry status code (0=UNSET, 1=OK, 2=ERROR)
   */
  statusCode: number;

  /**
   * Optional status message for errors
   */
  statusMessage: string | null;
}

/**
 * Database schema with all tables
 */
export interface TelemetryDatabase {
  spans: SpanRecord;
}

/**
 * Type-safe insertable span data
 */
export type NewSpan = Insertable<SpanRecord>;

/**
 * Type-safe selectable span data
 */
export type Span = Selectable<SpanRecord>;

/**
 * Type-safe updateable span data
 */
export type SpanUpdate = Updateable<SpanRecord>;
/**
 * SQL that creates the spans table and its indexes. Column names are camelCase to match SpanRecord.
 */
export const spansTableSql = `
  CREATE TABLE IF NOT EXISTS spans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contextId TEXT NOT NULL,
    turn INTEGER,
    traceId TEXT NOT NULL,
    spanId TEXT NOT NULL,
    parentSpanId TEXT,
    name TEXT NOT NULL,
    startTime INTEGER NOT NULL,
    endTime INTEGER NOT NULL,
    durationMs INTEGER NOT NULL,
    attributes TEXT,
    statusCode INTEGER NOT NULL,
    statusMessage TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_spans_contextId ON spans(contextId);
  CREATE INDEX IF NOT EXISTS idx_spans_turn ON spans(turn);
  CREATE INDEX IF NOT EXISTS idx_spans_traceId ON spans(traceId);
  CREATE INDEX IF NOT EXISTS idx_spans_parentSpanId ON spans(parentSpanId);
  CREATE INDEX IF NOT EXISTS idx_spans_startTime ON spans(startTime);
`;
