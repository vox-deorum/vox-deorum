/**
 * @module oracle/batch/types
 *
 * Batch manager configuration, internal queue types, and helpers.
 * OpenAI API types are imported from the official `openai` npm package.
 */

import type OpenAI from 'openai';
import type { Model } from '../../types/index.js';

/** Re-export commonly used OpenAI types for convenience */
export type ChatCompletionRequest = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
export type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
export type ChatCompletionMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

// ── Batch Manager Configuration ──

/** Options for initializing the batch manager */
export interface BatchManagerOptions {
  /** Directory for SQLite DB and temp JSONL files */
  stateDir: string;
  /** Time window to collect requests before flushing (ms, default 15000) */
  flushInterval?: number;
  /** How often to poll batch status (ms, default 30000) */
  pollInterval?: number;
  /** Max item-level retries before giving up (default 3) */
  maxItemRetries?: number;
  /** Max batch-level retries before giving up (default 3) */
  maxBatchRetries?: number;
}

// ── Internal Queue Types ──

/** A request waiting in the in-memory queue for the next batch flush */
export interface QueuedRequest {
  /** SHA-256 hash of modelId + params body, used as DB primary key */
  hash: string;
  /** Unique ID for this request within the batch */
  customId: string;
  /** Model identifier (e.g. "gpt-4o") included in the hash for cross-model dedup */
  modelId: string;
  /** Vercel AI SDK streamText params (messages, tools, toolChoice, etc.) */
  params: Record<string, any>;
  /** Model configuration for provider-specific conversion */
  modelConfig: Model;
  /** Resolves the caller's promise with the completion response */
  resolve: (response: ChatCompletion) => void;
  /** Rejects the caller's promise on failure */
  reject: (error: Error) => void;
  /** Provider name (e.g. "openai", "google") for DB persistence */
  provider: string;
  /** Normalized base URL identifying which BatchProvider to use */
  endpointKey: string;
  /** Timestamp when this request was enqueued */
  timestamp: number;
}

// ── Batch Status Helpers ──

/**
 * Whether a batch status is terminal (no more polling needed).
 * Terminal statuses: completed, failed, expired, cancelled.
 */
export function isTerminalBatchStatus(status: string): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'expired'
    || status === 'cancelled';
}

/**
 * Map Google JobState to normalized batch status.
 * Used by GoogleBatchProvider to convert native states.
 */
export function mapGoogleJobState(state: string | undefined): string {
  switch (state) {
    case 'JOB_STATE_QUEUED':
    case 'JOB_STATE_PENDING':
      return 'validating';
    case 'JOB_STATE_RUNNING':
      return 'in_progress';
    case 'JOB_STATE_SUCCEEDED':
      return 'completed';
    case 'JOB_STATE_FAILED':
      return 'failed';
    case 'JOB_STATE_CANCELLED':
      return 'cancelled';
    case 'JOB_STATE_EXPIRED':
      return 'expired';
    case 'JOB_STATE_CANCELLING':
      return 'cancelling';
    default:
      return 'in_progress';
  }
}
