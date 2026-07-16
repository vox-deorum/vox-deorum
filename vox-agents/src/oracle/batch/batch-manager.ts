/**
 * @module oracle/batch/batch-manager
 *
 * Queue-based batch manager for LLM batch APIs.
 *
 * Collects LLM requests over a configurable time window, submits them as
 * batches (grouped by provider endpoint), polls for completion, and resolves
 * each caller's promise with the result. Uses SQLite (via BatchDb) for durable
 * state so that in-flight batches survive process crashes and completed results
 * are cached.
 *
 * Supports multiple providers simultaneously — each provider gets its own
 * BatchProvider instance, and flush groups requests by endpoint before submitting.
 *
 * Lifecycle:
 *   startBatchManager(options)                    →  active, flush loop running
 *   getBatchManager().enqueue(params, modelConfig) →  Promise<ChatCompletion>
 *   shutdownBatchManager()                         →  flush remaining, wait, close DB
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { createLogger } from '../../utils/logger.js';
import { exponentialRetry } from '../../utils/retry.js';
import { BatchDb } from './batch-db.js';
import { getBatchEndpoint } from './batch-endpoints.js';
import { isTerminalBatchStatus } from './types.js';
import {
  BatchProvider,
  OpenAiBatchProvider,
  GoogleBatchProvider,
} from './providers/index.js';
import type {
  BatchManagerOptions,
  ChatCompletion,
  QueuedRequest,
} from './types.js';
import type { BatchEndpoint } from './batch-endpoints.js';
import type { Model } from '../../types/index.js';

const logger = createLogger('BatchManager');

// ── Singleton ──

/** Singleton batch manager instance */
let instance: BatchManager | null = null;

/**
 * Get the active BatchManager singleton.
 * Throws if not yet initialized via startBatchManager().
 */
export function getBatchManager(): BatchManager {
  if (!instance) {
    throw new Error('BatchManager not initialized. Call startBatchManager() first.');
  }
  return instance;
}

/**
 * Check if a BatchManager singleton exists (without throwing).
 * Used by streamTextWithConcurrency to check before routing.
 */
export function hasBatchManager(): boolean {
  return instance !== null && instance.isActive;
}

/**
 * Initialize and start the batch manager singleton.
 * Creates the SQLite database, resumes any in-flight batches from a previous
 * process, and begins the periodic flush loop.
 *
 * Endpoint resolution happens lazily per-model when requests are enqueued,
 * so no provider credentials are needed at startup.
 *
 * @param options - Batch manager configuration
 * @returns The initialized BatchManager
 */
export async function startBatchManager(
  options: BatchManagerOptions
): Promise<BatchManager> {
  if (instance) {
    logger.warn('BatchManager already initialized, returning existing instance');
    return instance;
  }
  instance = new BatchManager(options);
  await instance.start();
  return instance;
}

/**
 * Shut down the batch manager singleton.
 * Flushes any remaining queued requests, waits for in-flight batches,
 * and closes the database connection.
 */
export async function shutdownBatchManager(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}

// ── Batch Manager ──

/**
 * Core batch manager class.
 * Not exported directly — use the singleton functions above.
 */
class BatchManager {
  private batchDb: BatchDb;
  /** Lazily-created BatchProvider instances keyed by normalized baseURL */
  private batchProviders = new Map<string, BatchProvider>();
  private queue: QueuedRequest[] = [];
  /**
   * Promises waiting on in-flight batches.
   * Outer map: batch_id → inner map: custom_id → {resolve, reject}
   */
  private inFlightPromises = new Map<
    string,
    Map<string, { resolve: QueuedRequest['resolve']; reject: QueuedRequest['reject'] }>
  >();
  private flushTimer: NodeJS.Timeout | null = null;
  private active = false;
  private shuttingDown = false;
  /** Tracks all poll loops so shutdown can await them */
  private pollPromises: Promise<void>[] = [];
  /**
   * Counts how many times the same base content hash has been enqueued.
   * Oracle intentionally sends the same prompt multiple times (repetitions);
   * the occurrence index is appended to the hash so each run is unique.
   * On restart the counter resets to 0, but the DB already has hash:0, hash:1, etc.
   * so they match up via cache hits in order.
   */
  private hashOccurrences = new Map<string, number>();
  /** Monotonic counter for generating unique custom_ids within this process */
  private customIdCounter = 0;

  private readonly stateDir: string;
  private readonly flushInterval: number;
  private readonly pollInterval: number;
  private readonly maxItemRetries: number;
  private readonly maxBatchRetries: number;

  constructor(options: BatchManagerOptions) {
    this.stateDir = options.stateDir;
    this.flushInterval = options.flushInterval ?? 15_000;
    this.pollInterval = options.pollInterval ?? 30_000;
    this.maxItemRetries = options.maxItemRetries ?? 3;
    this.maxBatchRetries = options.maxBatchRetries ?? 3;

    // Ensure state directory exists for temp files
    fs.mkdirSync(this.stateDir, { recursive: true });

    // Initialize database (providers are created lazily per-endpoint)
    const dbPath = path.join(this.stateDir, 'batch.db');
    this.batchDb = new BatchDb(dbPath);
  }

  /** Whether the batch manager is active and accepting requests */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * Start the batch manager: create schema, resume in-flight batches, begin flush loop.
   */
  async start(): Promise<void> {
    if (this.active) return;

    await this.batchDb.createSchema();
    this.active = true;
    logger.info(
      `BatchManager started (flush=${this.flushInterval}ms, poll=${this.pollInterval}ms)`
    );

    // Resume any batches that were in-flight when the process last exited
    await this.resumeInFlightBatches();

    // Start the periodic flush loop
    this.flushTimer = setInterval(() => {
      if (this.queue.length > 0 && !this.shuttingDown) {
        this.flush().catch(err => logger.error('Flush error:', err));
      }
    }, this.flushInterval);
  }

  /**
   * Shut down gracefully: flush remaining queue, wait for polls, close DB.
   */
  async shutdown(): Promise<void> {
    if (!this.active) return;
    this.shuttingDown = true;

    // Stop the flush timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining queued requests
    if (this.queue.length > 0) {
      logger.info(`Flushing ${this.queue.length} remaining request(s) before shutdown`);
      await this.flush();
    }

    // Wait for all in-flight batch polls to complete
    if (this.pollPromises.length > 0) {
      logger.info(`Waiting for ${this.pollPromises.length} in-flight batch(es)...`);
      await Promise.allSettled(this.pollPromises);
    }

    this.active = false;
    await this.batchDb.destroy();
    logger.info('BatchManager shut down');
  }

  /**
   * Enqueue a request for batch processing.
   *
   * Returns a promise that resolves when the batch completes and the response
   * is available. If the same request (identified by content hash including
   * model ID) was already completed in a previous run, resolves immediately
   * from the SQLite cache.
   *
   * @param params - Vercel AI SDK streamText params (messages, tools, toolChoice, etc.)
   * @param modelConfig - Model configuration for provider endpoint resolution
   * @returns Promise resolving to the chat completion response
   */
  async enqueue(params: Record<string, any>, modelConfig: Model): Promise<ChatCompletion> {
    const modelId = modelConfig.name;

    // Resolve the endpoint for this model's provider and ensure a BatchProvider exists
    const endpoint = getBatchEndpoint(modelConfig);
    const endpointKey = endpoint.baseURL.replace(/\/+$/, '');
    this.getOrCreateProvider(endpoint);

    // Compute a base hash from the content, then append an occurrence index
    // so that identical requests (Oracle repetitions) get distinct hashes.
    const baseHash = this.hashRequest(modelId, params);
    const occurrence = this.hashOccurrences.get(baseHash) ?? 0;
    this.hashOccurrences.set(baseHash, occurrence + 1);
    const hash = `${baseHash}:${occurrence}`;

    // Check SQLite for an existing record with this hash
    const existing = await this.batchDb.findByHash(hash);

    if (existing) {
      // Already completed — resolve from cache
      if (existing.status === 'completed' && existing.responseBody) {
        logger.debug(`Cache hit for ${modelId} request ${hash.slice(0, 8)}`);
        return existing.responseBody as unknown as ChatCompletion;
      }

      // Already submitted in an in-flight batch — attach a new promise
      if (existing.status === 'submitted' && existing.batchId) {
        const batchPromises = this.inFlightPromises.get(existing.batchId);
        if (batchPromises) {
          logger.debug(`Attaching to in-flight batch ${existing.batchId} for ${hash.slice(0, 8)}`);
          return new Promise<ChatCompletion>((resolve, reject) => {
            batchPromises.set(existing.customId, { resolve, reject });
          });
        }
        // Batch promises map gone (stale from previous run with no resume) — fall through
      }

      // Failed but retriable — reset and re-enqueue
      if (existing.status === 'failed' && existing.retries < this.maxItemRetries) {
        await this.batchDb.resetForRetry(hash);
        // Fall through to enqueue
      } else if (existing.status === 'failed') {
        // Exhausted retries — reject immediately
        throw new Error(
          `Batch request failed after ${existing.retries} retries: ${existing.error}`
        );
      }

      // Status is 'pending' — already in DB from a previous run, just queue it
    } else {
      // New request — insert as 'pending' in the database
      const customId = this.generateCustomId(modelId);
      await this.batchDb.insertRequest({
        hash,
        modelId,
        customId,
        requestBody: JSON.stringify(params) as any,
        responseBody: null,
        error: null,
        status: 'pending',
        batchId: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      });
    }

    // Re-fetch to get the custom_id (may have been set in a previous run)
    const row = (await this.batchDb.findByHash(hash))!;

    return new Promise<ChatCompletion>((resolve, reject) => {
      this.queue.push({
        hash,
        customId: row.customId,
        modelId,
        params,
        modelConfig,
        resolve,
        reject,
        provider: endpoint.provider,
        endpointKey,
        timestamp: Date.now(),
      });
    });
  }

  // ── Internal: Provider Management ──

  /**
   * Get or create a BatchProvider instance for the given endpoint.
   * Instances are cached by normalized baseURL. Google gets a native
   * implementation using the GenAI SDK.
   */
  private getOrCreateProvider(endpoint: BatchEndpoint): BatchProvider {
    const key = endpoint.baseURL.replace(/\/+$/, '');
    let provider = this.batchProviders.get(key);
    if (!provider) {
      provider = endpoint.provider === 'google'
        ? new GoogleBatchProvider(endpoint.apiKey, endpoint)
        : new OpenAiBatchProvider(endpoint.apiKey, key, this.stateDir);
      this.batchProviders.set(key, provider);
      logger.info(`Created BatchProvider for endpoint: ${key} (${endpoint.provider})`);
    }
    return provider;
  }

  // ── Internal: Flush & Submit ──

  /**
   * Drain the in-memory queue, group requests by endpoint, and submit
   * each group as a separate batch.
   */
  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    // Drain the entire queue
    const all = this.queue.splice(0);
    logger.info(`Flushing ${all.length} request(s) to batch API`);

    // Group by endpoint
    const groups = new Map<string, QueuedRequest[]>();
    for (const q of all) {
      const group = groups.get(q.endpointKey) ?? [];
      group.push(q);
      groups.set(q.endpointKey, group);
    }

    // Submit each group as a separate batch (in parallel)
    await Promise.all(
      [...groups.entries()].map(([endpointKey, requests]) => {
        const provider = this.batchProviders.get(endpointKey)!;
        return this.submitBatch(requests, provider);
      })
    );
  }

  /**
   * Submit a group of requests as a single batch to the given provider.
   */
  private async submitBatch(batch: QueuedRequest[], provider: BatchProvider): Promise<void> {
    try {
      // Build BatchSubmitItem[] from queue entries
      const items = batch.map(q => ({
        customId: q.customId,
        params: q.params,
        modelConfig: q.modelConfig,
      }));

      // Submit with retry
      const batchResult = await exponentialRetry(
        async (update) => {
          const result = await provider.submitBatch(items);
          update(true);
          return result;
        },
        logger,
        {
          source: 'batch-submit',
          maxRetries: this.maxBatchRetries,
          initialDelay: 5000,
          maxDelay: 60000,
        },
      );

      const batchId = batchResult.id;
      const modelIds = [...new Set(batch.map(q => q.modelId))].join(',');

      // Record the batch in the database (include provider for crash recovery)
      await this.batchDb.insertBatch({
        batchId,
        provider: batch[0].provider,
        modelId: modelIds,
        status: batchResult.status,
        outputFileId: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
        requestCount: batch.length,
      });

      // Mark all requests as submitted
      const hashes = batch.map(q => q.hash);
      await this.batchDb.markSubmitted(hashes, batchId);

      // Register promises for resolution when results arrive
      const promiseMap = new Map<
        string,
        { resolve: QueuedRequest['resolve']; reject: QueuedRequest['reject'] }
      >();
      for (const q of batch) {
        promiseMap.set(q.customId, { resolve: q.resolve, reject: q.reject });
      }
      this.inFlightPromises.set(batchId, promiseMap);

      // Start polling in the background (tracked for shutdown)
      const pollPromise = this.pollBatch(batchId, provider);
      this.pollPromises.push(pollPromise);
      pollPromise.finally(() => {
        this.pollPromises = this.pollPromises.filter(p => p !== pollPromise);
      });

      logger.info(`Batch ${batchId} submitted with ${batch.length} request(s)`);
    } catch (error) {
      // Batch submission failed entirely — reject all promises and mark as failed
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Batch submission failed: ${errorMsg}`);

      for (const q of batch) {
        await this.batchDb.markFailed(q.customId, '', errorMsg);
        q.reject(new Error(`Batch submission failed: ${errorMsg}`));
      }
    }
  }

  // ── Internal: Polling ──

  /**
   * Poll a batch until it reaches a terminal status.
   * Updates the database on each poll and resolves/rejects promises on completion.
   */
  private async pollBatch(batchId: string, provider: BatchProvider): Promise<void> {
    logger.info(`Polling batch ${batchId}...`);

    while (true) {
      // Wait before polling (delay-first so the batch has time to process)
      await setTimeout(this.pollInterval);

      try {
        const statusResult = await provider.getBatchStatus(batchId);
        const { status } = statusResult;

        // Update the database with current status
        await this.batchDb.updateBatchStatus(batchId, status, {
          completedAt: statusResult.completedAt,
        });

        // Log progress if request counts are available
        if (statusResult.requestCounts) {
          const { total, completed, failed } = statusResult.requestCounts;
          logger.info(
            `Batch ${batchId}: ${completed}/${total} completed, ${failed} failed (status: ${status})`
          );
        }

        // Handle terminal states
        if (status === 'completed') {
          await this.downloadResults(batchId, provider);
          return;
        }

        if (isTerminalBatchStatus(status)) {
          // Failed, expired, or cancelled — reject all waiting promises
          const errorMsg = `Batch ${batchId} ended with status: ${status}`;
          logger.error(errorMsg);
          this.rejectBatchPromises(batchId, new Error(errorMsg));
          await this.batchDb.markBatchRequestsFailed(batchId, errorMsg);
          return;
        }
      } catch (error) {
        // Network error during poll — log and keep polling
        logger.warn(
          `Error polling batch ${batchId}: ${error instanceof Error ? error.message : error}`
        );
      }
    }
  }

  /**
   * Download results from a completed batch, save to DB, and resolve promises.
   */
  private async downloadResults(batchId: string, provider: BatchProvider): Promise<void> {
    logger.info(`Downloading results for batch ${batchId}`);

    const results = await provider.getResults(batchId);
    const promiseMap = this.inFlightPromises.get(batchId);

    // Process each result: save to DB and resolve/reject the corresponding promise
    for (const result of results) {
      if (result.response) {
        // Success — save response and resolve
        await this.batchDb.markCompleted(result.customId, batchId, result.response);
        promiseMap?.get(result.customId)?.resolve(result.response);
      } else {
        // Failure — save error and reject
        const errorMsg = result.error?.message ?? 'Unknown error';
        await this.batchDb.markFailed(result.customId, batchId, errorMsg);
        promiseMap?.get(result.customId)?.reject(
          new Error(`Batch request failed: ${errorMsg}`)
        );
      }
      promiseMap?.delete(result.customId);
    }

    // Handle any promises that didn't get a response (shouldn't happen, but be safe)
    if (promiseMap) {
      for (const [customId, promise] of promiseMap) {
        logger.warn(`No response found for custom_id ${customId} in batch ${batchId}`);
        promise.reject(new Error(`No response received for request ${customId}`));
      }
      this.inFlightPromises.delete(batchId);
    }

    logger.info(`Batch ${batchId} completed: ${results.length} result(s) processed`);
  }

  // ── Internal: Resume ──

  /**
   * Resume polling for batches that were in-flight when the process last exited.
   * Loads non-terminal batches from the database, reconstructs the BatchProvider
   * for each batch's provider, and starts polling.
   */
  private async resumeInFlightBatches(): Promise<void> {
    const batches = await this.batchDb.getInFlightBatches();
    if (batches.length === 0) return;

    logger.info(`Resuming ${batches.length} in-flight batch(es) from previous run`);

    for (const batch of batches) {
      // Reconstruct the BatchProvider from the stored provider
      const endpoint = getBatchEndpoint({ provider: batch.provider } as Model);
      const provider = this.getOrCreateProvider(endpoint);

      // Create an empty promise map — callers will attach when they re-enqueue
      this.inFlightPromises.set(batch.batchId, new Map());

      // Start polling in the background
      const pollPromise = this.pollBatch(batch.batchId, provider);
      this.pollPromises.push(pollPromise);
      pollPromise.finally(() => {
        this.pollPromises = this.pollPromises.filter(p => p !== pollPromise);
      });
    }
  }

  // ── Internal: Helpers ──

  /**
   * Compute a SHA-256 hash of the model ID and params for deduplication.
   * Including the model ID in the hash prevents the same prompt sent to
   * different models from colliding.
   */
  private hashRequest(modelId: string, params: Record<string, any>): string {
    const content = modelId + '\0' + JSON.stringify(params);
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Generate a unique custom_id for a request within a batch.
   * Scoped by model name to make IDs easier to debug in batch output.
   */
  private generateCustomId(modelId: string): string {
    const safeModel = modelId.replace(/[^a-zA-Z0-9._-]/g, '-');
    return `${safeModel}-${Date.now()}-${this.customIdCounter++}`;
  }

  /**
   * Reject all promises waiting on a specific batch.
   * Called when a batch reaches a terminal failure state.
   */
  private rejectBatchPromises(batchId: string, error: Error): void {
    const promiseMap = this.inFlightPromises.get(batchId);
    if (promiseMap) {
      for (const [, promise] of promiseMap) {
        promise.reject(error);
      }
      this.inFlightPromises.delete(batchId);
    }
  }
}
