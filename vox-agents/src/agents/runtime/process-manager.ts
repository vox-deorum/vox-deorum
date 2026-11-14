/**
 * @module agents/runtime/process-manager
 *
 * Global process lifecycle manager.
 * Consolidates signal handling and shutdown hooks across all console entry points.
 * Lazily registers signal handlers on first hook registration.
 */

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ProcessManager');

type ShutdownHook = () => Promise<void>;

/**
 * Manages process shutdown lifecycle with named hooks.
 * Signal handlers are lazily registered on the first `register()` call.
 * Hooks execute in insertion order during shutdown.
 *
 * @example
 * ```typescript
 * import { processManager } from './agents/runtime/process-manager.js';
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
   * A second signal skips the remaining hooks and exits at once.
   */
  async shutdown(signal: string): Promise<void> {
    if (this.shuttingDown) {
      // Registering a SIGINT listener suppresses Node's default terminate-on-Ctrl+C, so this
      // is the only way out while a slow or stuck hook is still running.
      logger.warn(`Received ${signal} during shutdown; exiting now.`);
      process.exit(130); // 128 + SIGINT
    }
    this.shuttingDown = true;

    logger.info(`Received ${signal}, shutting down gracefully... (press Ctrl+C again to force-quit)`);

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
 * import { processManager } from './agents/runtime/process-manager.js';
 * processManager.register('my-service', async () => { ... });
 * ```
 */
export const processManager = new ProcessManager();
