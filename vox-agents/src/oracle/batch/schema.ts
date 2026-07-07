/**
 * @module oracle/batch/schema
 *
 * Kysely database schema for batch request persistence.
 * Follows the pattern from utils/telemetry/schema.ts.
 *
 * Two tables:
 * - `requests`: Individual chat completion requests with deduplication hash,
 *   status tracking, and cached response bodies.
 * - `batches`: OpenAI Batch API batch objects with status and file IDs.
 */

import type { Generated, Insertable, Selectable, JSONColumnType } from 'kysely';
import type { ChatCompletionRequest, ChatCompletion } from './types.js';

/**
 * A single chat completion request tracked through the batch lifecycle.
 * Primary key is a content hash that includes the model ID, enabling
 * deduplication across process restarts and preventing cross-model collisions.
 */
export interface BatchRequestRecord {
  /** SHA-256(modelId + '\0' + JSON.stringify(requestBody)) */
  hash: string;
  /** Model identifier, e.g. "gpt-4o" — included in hash to prevent cross-model collisions */
  modelId: string;
  /** Unique ID within the JSONL batch file, scoped by model */
  customId: string;
  /** OpenAI batch ID this request was submitted in (null while pending) */
  batchId: string | null;
  /** Full OpenAI chat completion request body as JSON */
  requestBody: JSONColumnType<ChatCompletionRequest>;
  /** Full OpenAI chat completion response body as JSON (null until completed) */
  responseBody: JSONColumnType<ChatCompletion> | null;
  /** Error message if this request failed */
  error: string | null;
  /** Lifecycle status: pending → submitted → completed | failed */
  status: string;
  /** Number of times this request has been retried after failure */
  retries: Generated<number>;
  /** ISO timestamp of when this request was first enqueued */
  createdAt: string;
  /** ISO timestamp of when the response was received */
  completedAt: string | null;
}

/**
 * An OpenAI Batch API batch object.
 * Tracks the batch through upload → creation → polling → completion.
 */
export interface BatchRecord {
  /** OpenAI batch ID (e.g. "batch_abc123") */
  batchId: string;
  /** Provider name used for this batch (needed to reconstruct endpoint on resume) */
  provider: string;
  /** Comma-separated model IDs included in this batch (for logging/debugging) */
  modelId: string;
  /** Current batch status from the OpenAI API */
  status: string;
  /** OpenAI file ID of the output JSONL (set when completed) */
  outputFileId: string | null;
  /** ISO timestamp of batch creation */
  createdAt: string;
  /** ISO timestamp of batch completion */
  completedAt: string | null;
  /** Number of requests in this batch */
  requestCount: number;
}

/** Root database interface combining all tables */
export interface BatchDatabase {
  requests: BatchRequestRecord;
  batches: BatchRecord;
}

/** Type-safe insertable request data (Generated fields optional) */
export type NewBatchRequest = Insertable<BatchRequestRecord>;
/** Type-safe selectable request data (all fields present) */
export type BatchRequest = Selectable<BatchRequestRecord>;
/** Type-safe insertable batch data */
export type NewBatch = Insertable<BatchRecord>;
/** Type-safe selectable batch data */
export type Batch = Selectable<BatchRecord>;
