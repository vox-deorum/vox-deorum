/**
 * In-memory telemetry databases that use the production spans schema, for tests that read spans.
 */

import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { spansTableSql, type TelemetryDatabase } from '../../src/utils/telemetry/schema.js';

/** One span row to seed. Timing and status columns get fixed defaults. */
export interface SpanSeed {
  contextId?: string;
  turn: number | null;
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  name: string;
  startTime?: number;
  /** Objects are stored as JSON like the exporter does; strings and null are stored as given. */
  attributes?: Record<string, unknown> | string | null;
}

/** An in-memory telemetry database with its raw SQLite handle for extra inserts. */
export interface TelemetryDbFixture {
  sqlite: Database.Database;
  db: Kysely<TelemetryDatabase>;
}

/** Insert span seeds into a spans table, filling the columns tests do not care about. */
export function insertSpans(sqlite: Database.Database, spans: SpanSeed[]): void {
  const insert = sqlite.prepare(`
    INSERT INTO spans (contextId, turn, traceId, spanId, parentSpanId, name,
      startTime, endTime, durationMs, attributes, statusCode, statusMessage)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  spans.forEach((span, index) => {
    const startTime = span.startTime ?? index + 1;
    const attributes = span.attributes === undefined
      ? '{}'
      : typeof span.attributes === 'string' || span.attributes === null
        ? span.attributes
        : JSON.stringify(span.attributes);
    insert.run(
      span.contextId ?? 'fixture-context', span.turn, span.traceId, span.spanId,
      span.parentSpanId ?? null, span.name, startTime, startTime + 1, 1, attributes, 1, null
    );
  });
}

/** Open an in-memory telemetry database with the exporter's schema and the given spans. */
export function createTelemetryDb(spans: SpanSeed[] = []): TelemetryDbFixture {
  const sqlite = new Database(':memory:');
  sqlite.exec(spansTableSql);
  insertSpans(sqlite, spans);
  const db = new Kysely<TelemetryDatabase>({ dialect: new SqliteDialect({ database: sqlite }) });
  return { sqlite, db };
}
