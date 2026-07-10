/**
 * @module infra/context-registry
 *
 * Registry for tracking active VoxContext instances.
 * Provides automatic registration on creation and cleanup on shutdown.
 * Ensures all contexts are properly managed and can be globally accessed or terminated.
 */

import { VoxContext } from "./vox-context.js";
import { AgentParameters } from "./vox-agent.js";
import { createLogger } from "../utils/logger.js";

/**
 * Registry for managing active VoxContext instances.
 * Tracks all contexts by ID and provides cleanup capabilities.
 */
class ContextRegistry {
  private logger = createLogger('ContextRegistry');

  /**
   * Map of active contexts indexed by their unique IDs
   */
  private contexts: Map<string, VoxContext<any>> = new Map();

  /**
   * Register a new VoxContext instance.
   * Called automatically when a VoxContext is created.
   *
   * @param context - The VoxContext instance to register
   */
  public register<T extends AgentParameters>(context: VoxContext<T>): void {
    if (this.contexts.has(context.id)) {
      this.logger.warn(`Context ${context.id} is already registered, replacing existing context`);
    }

    this.contexts.set(context.id, context);
    this.logger.info(`Registered context ${context.id} (total active: ${this.contexts.size})`);
  }

  /**
   * Unregister a VoxContext instance.
   * Called automatically when a VoxContext is shut down.
   *
   * @param contextId - The ID of the context to unregister
   * @returns true if the context was found and unregistered, false otherwise
   */
  public unregister(contextId: string): boolean {
    const wasDeleted = this.contexts.delete(contextId);

    if (wasDeleted) {
      this.logger.info(`Unregistered context ${contextId} (remaining active: ${this.contexts.size})`);
    } else {
      this.logger.warn(`Attempted to unregister non-existent context ${contextId}`);
    }

    return wasDeleted;
  }

  /**
   * Get a specific VoxContext by ID.
   *
   * @param contextId - The ID of the context to retrieve
   * @returns The VoxContext if found, undefined otherwise
   */
  public get<T extends AgentParameters>(contextId: string): VoxContext<T> | undefined {
    return this.contexts.get(contextId) as VoxContext<T> | undefined;
  }

  /**
   * Get all active VoxContext instances.
   *
   * @returns Array of all active contexts
   */
  public getAll(): VoxContext<any>[] {
    return Array.from(this.contexts.values());
  }

  /**
   * Shutdown all active contexts.
   * Useful for graceful application shutdown or cleanup.
   *
   * @returns Promise that resolves when all contexts are shut down
   */
  public async shutdownAll(): Promise<void> {
    const contextIds = Array.from(this.contexts.keys());

    if (contextIds.length === 0) return;
    this.logger.info(`Shutting down ${contextIds.length} active contexts`);

    // Shutdown all contexts in parallel
    const shutdownPromises = contextIds.map(async (id) => {
      try {
        const context = this.contexts.get(id);
        if (context) await context.shutdown();
      } catch (error) {
        this.logger.error(`Failed to shutdown context ${id}:`, error);
        // Continue with other shutdowns even if one fails
      }
    });

    await Promise.allSettled(shutdownPromises);

    // Clear any remaining contexts (in case shutdown didn't unregister)
    this.contexts.clear();
    this.logger.info('All contexts shutdown complete');
  }
}

// Export singleton instance
export const contextRegistry = new ContextRegistry();

// Export type for testing or extension
export type { ContextRegistry };