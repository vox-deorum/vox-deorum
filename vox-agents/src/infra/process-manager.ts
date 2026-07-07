/**
 * @module infra/process-manager
 *
 * Global process lifecycle manager.
 * Consolidates signal handling and shutdown hooks across all console entry points.
 * Lazily registers signal handlers on first hook registration.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('ProcessManager');

type ShutdownHook = () => Promise<void>;

/**
 * Manages process shutdown lifecycle with named hooks.
 * Signal handlers are lazily registered on the first `register()` call.
 * Hooks execute in insertion order during shutdown.
 *
 * @example
 * ```typescript
 * import { processManager } from './infra/process-manager.js';
 *
 * processManager.register('session', async () => {
 *   await session.shutdown();
 * });
 * processManager.register('telemetry', async () => {
 *   await sqliteExporter.forceFlush();
 * });
 * ```
 */
class ProcessManager {
  private hooks = new Map<string, ShutdownHook>();
  private signalsRegistered = false;
  private shuttingDown = false;

  /**
   * Register a named shutdown hook. Lazily sets up signal handlers on first call.
   */
  register(name: string, hook: ShutdownHook): void {
    this.hooks.set(name, hook);

    if (!this.signalsRegistered) {
      this.signalsRegistered = true;
      const handler = (signal: string) => this.shutdown(signal);
      process.on('SIGINT', () => handler('SIGINT'));
      process.on('SIGTERM', () => handler('SIGTERM'));
      process.on('SIGBREAK', () => handler('SIGBREAK'));
      process.on('SIGHUP', () => handler('SIGHUP'));
      logger.debug('Signal handlers registered');
    }
  }

  /**
   * Execute all registered hooks in order, then exit.
   * Safe to call multiple times — only the first invocation runs hooks.
   */
  async shutdown(signal: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    logger.info(`Received ${signal}, shutting down gracefully...`);

    for (const [name, hook] of this.hooks) {
      try {
        logger.debug(`Running shutdown hook: ${name}`);
        await hook();
      } catch (error) {
        logger.error(`Error in shutdown hook '${name}':`, error);
      }
    }

    process.exit(0);
  }

  /**
   * Whether the process is currently shutting down.
   */
  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }
}

/**
 * Singleton ProcessManager instance.
 *
 * @example
 * ```typescript
 * import { processManager } from './infra/process-manager.js';
 * processManager.register('my-service', async () => { ... });
 * ```
 */
export const processManager = new ProcessManager();
