/**
 * @module utils/telemetry/sqlite-exporter
 *
 * OpenTelemetry span exporter using Kysely for type-safe database operations.
 * Each VoxContext gets its own database file for easy analysis and debugging.
 * Uses WAL (Write-Ahead Logging) mode for better concurrent access.
 */

import { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import { Kysely } from 'kysely';
import Database from 'better-sqlite3';
import { openSqliteKysely, openSqliteKyselyReadonly } from './sqlite-helpers.js';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { createLogger } from '../logger.js';
import { spanProcessor } from '../../instrumentation.js';
import { VoxSpanExporter } from './vox-exporter.js';
import { spansTableSql, type TelemetryDatabase, type NewSpan } from './schema.js';

const logger = createLogger('SQLiteExporter');

/**
 * Database connection info storing both Kysely and SQLite instances
 */
interface DatabaseConnection {
  kysely: Kysely<TelemetryDatabase>;
  sqlite: Database.Database;
}

/**
 * Map of context IDs to database connections
 */
const databases = new Map<string, DatabaseConnection>();

/**
 * Map of context IDs to custom folders
 */
const customFolders = new Map<string, string>();

/**
 * Custom OpenTelemetry span exporter that writes to SQLite databases using Kysely.
 * Groups trace data by VoxContext ID for easier analysis.
 * Emits events when new spans are exported for real-time streaming.
 */
export class SQLiteSpanExporter extends VoxSpanExporter {
  private dataDir: string;
  private eventEmitter: EventEmitter;

  constructor(dataDir: string = 'telemetry') {
    super();
    this.dataDir = dataDir;
    this.eventEmitter = new EventEmitter();
    this.ensureDataDirectory();
  }

  /**
   * Ensure the data directory exists
   */
  private ensureDataDirectory(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      logger.info(`Created telemetry directory: ${this.dataDir}`);
    }
  }

  /**
   * Get or create a Kysely database instance for a specific context
   * Overrides the optional method from VoxSpanExporter
   */
  public getDatabase(contextId: string): Kysely<TelemetryDatabase> {
    if (!databases.has(contextId)) {
      const filename = this.getDatabasePath(contextId);
      fs.mkdirSync(path.dirname(filename), { recursive: true });

      const { db: kyselyDb, sqlite: sqliteDb } = openSqliteKysely<TelemetryDatabase>(filename);

      sqliteDb.exec(spansTableSql);

      // Store both Kysely and SQLite instances
      databases.set(contextId, { kysely: kyselyDb, sqlite: sqliteDb });
      logger.info(`Created Kysely database for context ${contextId}`);
    }

    return databases.get(contextId)!.kysely;
  }

  /**
   * The database file for a context: `<dataDir>/<folder>/<contextId>.db`, where the folder is the
   * one registered by {@link createContext}, or the context ID's first dash-separated part.
   * Other stores, such as a seat's workspace store, keep their tables in the same file.
   */
  public getDatabasePath(contextId: string): string {
    const folder = customFolders.get(contextId) ?? contextId.split("-")[0];
    return path.join(this.dataDir, folder, `${contextId}.db`);
  }

  /**
   * Extract turn number from span attributes
   */
  private extractTurn(attributes: Record<string, any>): number | null {
    // Try different possible attribute names for turn
    const turn = attributes['game.turn'];

    if (turn !== undefined && turn !== null) {
      const turnNum = typeof turn === 'number' ? turn : parseInt(turn);
      return isNaN(turnNum) ? null : turnNum;
    }

    return null;
  }

  /**
   * Convert a ReadableSpan to a database row
   */
  private spanToRow(span: ReadableSpan): NewSpan | null {
    const contextId = span.attributes['vox.context.id'] as string || 'unknown';

    if (contextId === 'unknown') {
      // Only care about the telemetry we need
      logger.warn(`Unknown span: ${JSON.stringify(span.attributes)}`);
      return null;
    }

    const traceId = span.spanContext().traceId;
    const spanId = span.spanContext().spanId;
    // Properly access parent span ID from parentSpanContext
    const parentSpanId = span.parentSpanContext ? span.parentSpanContext.spanId : null;

    // Extract turn before cleaning attributes
    const turn = this.extractTurn(span.attributes);

    // Clean up attributes to avoid duplication
    const attributes = { ...span.attributes };
    delete attributes['vox.context.id'];
    delete attributes['game.turn'];

    // Return object matching NewSpan type (Insertable<SpanRecord>)
    return {
      contextId,
      turn,
      traceId,
      spanId,
      parentSpanId,
      name: span.name,
      startTime: Math.floor(span.startTime[0] * 1e9 + span.startTime[1]), // Convert to nanoseconds
      endTime: Math.floor(span.endTime[0] * 1e9 + span.endTime[1]),
      durationMs: Math.floor((span.endTime[0] - span.startTime[0]) * 1000 +
                              (span.endTime[1] - span.startTime[1]) / 1e6),
      // JSONColumnType handles serialization automatically
      attributes: Object.keys(attributes).length > 0 ? JSON.stringify(attributes) : null,
      statusCode: span.status.code,
      statusMessage: span.status.message || null,
    };
  }

  /**
   * Subscribe to span export events for a specific context
   */
  public onSpansExported(contextId: string, listener: (spans: NewSpan[]) => void): void {
    this.eventEmitter.on(`spans-exported:${contextId}`, listener);
  }

  /**
   * Unsubscribe from span export events for a specific context
   */
  public offSpansExported(contextId: string, listener: (spans: NewSpan[]) => void): void {
    this.eventEmitter.off(`spans-exported:${contextId}`, listener);
  }

  /**
   * Export spans to SQLite databases using Kysely
   */
  async export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): Promise<void> {
    try {
      // Group spans by context ID for batch inserts
      const spansByContext = new Map<string, NewSpan[]>();

      for (const span of spans) {
        const row = this.spanToRow(span);
        if (!row) continue;

        const contextId = row.contextId;
        if (!spansByContext.has(contextId)) {
          spansByContext.set(contextId, []);
        }
        spansByContext.get(contextId)!.push(row);
      }

      // Batch insert spans for each context using Kysely
      for (const [contextId, contextSpans] of spansByContext) {
        const db = this.getDatabase(contextId);

        // Use Kysely's insertInto for type-safe batch inserts
        if (contextSpans.length > 0) {
          await db.insertInto('spans')
            .values(contextSpans)
            .execute();

          // Emit event for real-time streaming
          this.eventEmitter.emit(`spans-exported:${contextId}`, contextSpans);
        }
      }

      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (error) {
      logger.error('Error exporting spans to SQLite', error);
      resultCallback({
        code: ExportResultCode.FAILED,
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
  }

  /**
   * Force flush all pending spans
   */
  async forceFlush(): Promise<void> {
    try {
      await spanProcessor.forceFlush();

      // Checkpoint all databases to ensure data is written
      for (const connection of databases.values()) {
        connection.sqlite.pragma('wal_checkpoint(TRUNCATE)');
      }

      logger.info('Force flushed all telemetry data');
    } catch (error) {
      logger.error('Error during force flush', error);
      throw error;
    }
  }

  /**
   * Create a context with a specific folder for its telemetry data
   */
  async createContext(contextId: string, folder: string): Promise<void> {
    try {
      customFolders.set(contextId, folder);
      logger.info(`Registered custom folder for context ${contextId}: ${folder}`);
    } catch (error) {
      logger.error(`Error creating context ${contextId} with folder ${folder}`, error);
      throw error;
    }
  }

  /**
   * Close the database for a specific context
   */
  async closeContext(contextId: string): Promise<void> {
    try {
      const connection = databases.get(contextId);
      if (connection) {
        // Checkpoint the SQLite database
        connection.sqlite.pragma('wal_checkpoint(TRUNCATE)');

        // Destroy Kysely instance and close SQLite database
        await connection.kysely.destroy();
        connection.sqlite.close();

        databases.delete(contextId);
        logger.info(`Closed Kysely database for context ${contextId}`);
      }
    } catch (error) {
      logger.error(`Error closing database for context ${contextId}`, error);
      throw error;
    } finally {
      customFolders.delete(contextId);
    }
  }

  /**
   * Get all database files in the telemetry directory
   */
  async getDatabaseFiles(): Promise<string[]> {
    try {
      const files: string[] = [];

      const walkDir = async (dir: string, relativePath: string = '') => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.join(relativePath, entry.name);

          if (entry.isDirectory()) {
            await walkDir(fullPath, relPath);
          } else if (entry.isFile() && entry.name.endsWith('.db')) {
            files.push(relPath);
          }
        }
      };

      if (fs.existsSync(this.dataDir)) {
        await walkDir(this.dataDir);
      }

      return files.sort();
    } catch (error) {
      logger.error('Error listing database files', error);
      return [];
    }
  }

  /**
   * Get active database connections
   */
  getActiveConnections(): string[] {
    return Array.from(databases.keys());
  }
  
  /** The absolute telemetry folder that database files are listed from and resolved against. */
  get rootDir(): string {
    return path.resolve(this.dataDir);
  }

  /**
   * The absolute path of a database file named relative to the telemetry folder, or undefined when
   * the path leaves the folder or does not name a `.db` file.
   */
  resolveDatabaseFile(relativePath: string): string | undefined {
    const root = this.rootDir;
    const fullPath = path.resolve(root, relativePath);
    const relative = path.relative(root, fullPath);
    if (!fullPath.endsWith('.db') || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    return fullPath;
  }

  /**
   * Open a specific database file for querying (read-only)
   */
  openDatabaseFile(relativePath: string): Kysely<TelemetryDatabase> | null {
    try {
      const fullPath = this.resolveDatabaseFile(relativePath);

      if (!fullPath || !fs.existsSync(fullPath)) {
        logger.warn(`Database file not found: ${relativePath}`);
        return null;
      }

      return openSqliteKyselyReadonly<TelemetryDatabase>(fullPath).db;
    } catch (error) {
      logger.error(`Error opening database file ${relativePath}`, error);
      return null;
    }
  }

  /**
   * Shutdown the exporter
   */
  async shutdown(): Promise<void> {
    try {
      // Force flush first
      await this.forceFlush();

      // Close all contexts properly
      const contextIds = Array.from(databases.keys());
      for (const contextId of contextIds) {
        await this.closeContext(contextId);
      }

      logger.info('SQLite exporter shut down');
    } catch (error) {
      logger.error('Error during shutdown', error);
      throw error;
    }
  }
}

// Export types for external usage
export type { TelemetryDatabase, Span, NewSpan, SpanUpdate, SpanAttributes } from './schema.js';
