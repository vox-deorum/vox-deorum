/**
 * @module oracle/batch/batch-db
 *
 * SQLite database layer for batch request persistence using Kysely.
 * Encapsulates all database operations: schema creation, request lifecycle
 * tracking, batch status updates, and query helpers.
 *
 * Follows the patterns from utils/telemetry/sqlite-exporter.ts and
 * mcp-server/src/knowledge/store.ts.
 */

import { Kysely } from 'kysely';
import { openSqliteKysely } from '../../utils/telemetry/sqlite-helpers.js';
import { createLogger } from '../../utils/logger.js';
import type { ChatCompletion } from './types.js';
import type { BatchDatabase, BatchRequest, Batch, NewBatchRequest, NewBatch } from './schema.js';

const logger = createLogger('BatchDb');

/**
 * Database access layer for batch request persistence.
 * Uses better-sqlite3 via Kysely for type-safe operations with WAL mode
 * for safe concurrent access.
 */
export class BatchDb {
  private db: Kysely<BatchDatabase>;

  /**
   * Open (or create) the batch database at the given path.
   * Runs schema creation with IF NOT EXISTS so it's safe to call repeatedly.
   *
   * @param dbPath - Absolute or relative path to the SQLite database file
   */
  constructor(dbPath: string) {
    this.db = openSqliteKysely<BatchDatabase>(dbPath).db;

    logger.info(`Batch database opened at ${dbPath}`);
  }

  /**
   * Create tables and indexes if they don't already exist.
   * Must be called once after construction before any queries.
   */
  async createSchema(): Promise<void> {
    // Requests table: tracks individual chat completion requests
    await this.db.schema
      .createTable('requests')
      .ifNotExists()
      .addColumn('hash', 'text', col => col.primaryKey())
      .addColumn('modelId', 'text', col => col.notNull())
      .addColumn('customId', 'text', col => col.notNull())
      .addColumn('batchId', 'text')
      .addColumn('requestBody', 'text', col => col.notNull())
      .addColumn('responseBody', 'text')
      .addColumn('error', 'text')
      .addColumn('status', 'text', col => col.notNull().defaultTo('pending'))
      .addColumn('retries', 'integer', col => col.notNull().defaultTo(0))
      .addColumn('createdAt', 'text', col => col.notNull())
      .addColumn('completedAt', 'text')
      .execute();

    // Batches table: tracks OpenAI batch objects
    await this.db.schema
      .createTable('batches')
      .ifNotExists()
      .addColumn('batchId', 'text', col => col.primaryKey())
      .addColumn('provider', 'text', col => col.notNull())
      .addColumn('modelId', 'text', col => col.notNull())
      .addColumn('status', 'text', col => col.notNull())
      .addColumn('outputFileId', 'text')
      .addColumn('createdAt', 'text', col => col.notNull())
      .addColumn('completedAt', 'text')
      .addColumn('requestCount', 'integer', col => col.notNull())
      .execute();

    // Indexes for common query patterns
    await this.db.schema
      .createIndex('idx_requests_status')
      .on('requests')
      .column('status')
      .ifNotExists()
      .execute();

    await this.db.schema
      .createIndex('idx_requests_batchId')
      .on('requests')
      .column('batchId')
      .ifNotExists()
      .execute();

    await this.db.schema
      .createIndex('idx_batches_status')
      .on('batches')
      .column('status')
      .ifNotExists()
      .execute();

    logger.info('Batch database schema initialized');
  }

  // ── Request Operations ──

  /**
   * Look up a request by its content hash.
   * Used for deduplication: if a matching request exists, the caller can
   * resolve from cache or attach to an in-flight batch instead of re-submitting.
   *
   * @param hash - SHA-256 hash of modelId + request body
   * @returns The request record if found, undefined otherwise
   */
  async findByHash(hash: string): Promise<BatchRequest | undefined> {
    return await this.db
      .selectFrom('requests')
      .selectAll()
      .where('hash', '=', hash)
      .executeTakeFirst();
  }

  /**
   * Insert a new request into the database as 'pending'.
   * Uses ON CONFLICT DO NOTHING to handle concurrent enqueue calls
   * for the same request hash (race between findByHash and insert).
   *
   * @param req - Insertable request record (hash, modelId, customId, requestBody, etc.)
   */
  async insertRequest(req: NewBatchRequest): Promise<void> {
    await this.db
      .insertInto('requests')
      .values(req)
      .onConflict(oc => oc.column('hash').doNothing())
      .execute();
  }

  /**
   * Mark a set of requests as 'submitted' and associate them with a batch.
   * Called after a batch is successfully created via the OpenAI API.
   *
   * @param hashes - Content hashes of the requests in this batch
   * @param batchId - OpenAI batch ID
   */
  async markSubmitted(hashes: string[], batchId: string): Promise<void> {
    if (hashes.length === 0) return;

    await this.db
      .updateTable('requests')
      .set({ status: 'submitted', batchId })
      .where('hash', 'in', hashes)
      .execute();
  }

  /**
   * Mark a request as 'completed' and store its response body.
   * Called when results are downloaded from a completed batch.
   *
   * @param customId - The request's custom_id within the batch JSONL
   * @param batchId - The batch this request belongs to
   * @param responseBody - The full chat completion response
   */
  async markCompleted(
    customId: string,
    batchId: string,
    responseBody: ChatCompletion
  ): Promise<void> {
    await this.db
      .updateTable('requests')
      .set({
        status: 'completed',
        responseBody: JSON.stringify(responseBody) as any,
        completedAt: new Date().toISOString(),
      })
      .where('customId', '=', customId)
      .where('batchId', '=', batchId)
      .execute();
  }

  /**
   * Mark a request as 'failed' and increment its retry counter.
   * The request may be retried on the next flush if retries < maxRetries.
   *
   * @param customId - The request's custom_id within the batch JSONL
   * @param batchId - The batch this request belongs to
   * @param error - Error message from the API or batch output
   */
  async markFailed(customId: string, batchId: string, error: string): Promise<void> {
    // Use raw SQL for retries = retries + 1 since Kysely doesn't support column references in set()
    await this.db
      .updateTable('requests')
      .set((eb) => ({
        status: 'failed',
        error,
        retries: eb('retries', '+', 1),
      }))
      .where('customId', '=', customId)
      .where('batchId', '=', batchId)
      .execute();
  }

  /**
   * Mark all submitted requests in a batch as 'failed'.
   * Called when a batch reaches a terminal failure status (failed/expired/cancelled).
   *
   * @param batchId - The batch that failed
   * @param error - Error message describing the failure
   */
  async markBatchRequestsFailed(batchId: string, error: string): Promise<void> {
    await this.db
      .updateTable('requests')
      .set({ status: 'failed', error })
      .where('batchId', '=', batchId)
      .where('status', '=', 'submitted')
      .execute();
  }

  /**
   * Reset a failed request back to 'pending' for retry.
   * Clears the batch association and error so it can be re-enqueued.
   *
   * @param hash - Content hash of the request to retry
   */
  async resetForRetry(hash: string): Promise<void> {
    await this.db
      .updateTable('requests')
      .set({
        status: 'pending',
        batchId: null,
        error: null,
      })
      .where('hash', '=', hash)
      .execute();
  }

  // ── Batch Operations ──

  /**
   * Insert a new batch record after successful creation via the OpenAI API.
   *
   * @param batch - Insertable batch record
   */
  async insertBatch(batch: NewBatch): Promise<void> {
    await this.db
      .insertInto('batches')
      .values(batch)
      .execute();
  }

  /**
   * Update a batch's status and optional metadata fields.
   * Called after each poll to keep the database in sync with the API state.
   *
   * @param batchId - OpenAI batch ID
   * @param status - New status from the API
   * @param extras - Additional fields to update (outputFileId, completedAt, etc.)
   */
  async updateBatchStatus(
    batchId: string,
    status: string,
    extras?: Partial<Pick<Batch, 'outputFileId' | 'completedAt'>>
  ): Promise<void> {
    await this.db
      .updateTable('batches')
      .set({ status, ...extras })
      .where('batchId', '=', batchId)
      .execute();
  }

  /**
   * Find all batches that are still in-flight (non-terminal status).
   * Used on startup to resume polling for batches from a previous process.
   *
   * @returns Batches with status 'validating' or 'in_progress'
   */
  async getInFlightBatches(): Promise<Batch[]> {
    return await this.db
      .selectFrom('batches')
      .selectAll()
      .where('status', 'in', ['validating', 'in_progress'])
      .execute();
  }

  // ── Lifecycle ──

  /**
   * Close the database connection.
   * Should be called during shutdown to ensure WAL checkpoint completes.
   */
  async destroy(): Promise<void> {
    await this.db.destroy();
    logger.info('Batch database connection closed');
  }
}
