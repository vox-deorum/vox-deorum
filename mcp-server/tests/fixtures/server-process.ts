/** Shared helpers for starting the source MCP server in tests and test child processes. */
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

/** Wait until HTTP startup writes its shutdown URL, which carries the OS-assigned port. */
export async function readPublishedUrl(filePath: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return (await readFile(filePath, 'utf8')).trim();
    } catch {
      await setTimeout(10);
    }
  }
  throw new Error('MCP server did not publish its shutdown URL');
}

/**
 * Keep the MCP server, transports, and tools real while startup stops depending on a
 * Civ database, game process, or bridge service. Returns a function that undoes it.
 * The managers load lazily so importing this module never loads the server early.
 */
export async function isolateExternalManagers(): Promise<() => void> {
  const { BridgeManager } = await import('../../src/bridge/manager.js');
  const { DatabaseManager } = await import('../../src/database/manager.js');
  const { KnowledgeManager } = await import('../../src/knowledge/manager.js');
  const bridge = BridgeManager.prototype as any;
  const originals = {
    databaseInitialize: DatabaseManager.prototype.initialize,
    knowledgeInitialize: KnowledgeManager.prototype.initialize,
    startQueueProcessorLoop: bridge.startQueueProcessorLoop,
    checkHealth: bridge.checkHealth,
    connectSSE: bridge.connectSSE,
    shutdown: bridge.shutdown,
  };
  DatabaseManager.prototype.initialize = async function () {};
  KnowledgeManager.prototype.initialize = async function () {};
  bridge.startQueueProcessorLoop = function () {};
  bridge.checkHealth = async function () {
    return { success: true, dll_connected: false, uptime: 0, version: 'fixture' };
  };
  bridge.connectSSE = function () {};
  bridge.shutdown = async function () {};
  return () => {
    DatabaseManager.prototype.initialize = originals.databaseInitialize;
    KnowledgeManager.prototype.initialize = originals.knowledgeInitialize;
    bridge.startQueueProcessorLoop = originals.startQueueProcessorLoop;
    bridge.checkHealth = originals.checkHealth;
    bridge.connectSSE = originals.connectSSE;
    bridge.shutdown = originals.shutdown;
  };
}

/**
 * Run cleanup once when the MCP client closes stdin or signals the child, then exit so
 * the client never has to force-kill it and skip cleanup.
 */
export function exitWhenClientCloses(cleanup: () => Promise<void>): void {
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await cleanup();
    } finally {
      process.exit(0);
    }
  };
  process.stdin.once('end', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGBREAK', () => { void shutdown(); });
}
