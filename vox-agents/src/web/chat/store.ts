/**
 * @module web/chat/store
 *
 * Owns the Web chat thread cache. Diplomacy reads refresh from the durable transcript store,
 * while ordinary chats remain memory-only.
 */

import type { ChatThreadStoreDependencies, EnvoyThread } from '../../types/index.js';
import { contextRegistry } from '../../infra/context-registry.js';
import { syncThreadMessages } from '../../utils/diplomacy/transcript.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('webui:chat-store');

/** In-memory chat thread cache with explicit durable read and cleanup boundaries. */
export class ChatThreadStore {
  private readonly threads = new Map<string, EnvoyThread>();

  /** Create a thread store with injected transcript refresh and context cleanup behavior. */
  constructor(private readonly dependencies: ChatThreadStoreDependencies) {}

  /** Return every cached thread without refreshing durable transcripts. */
  list(): EnvoyThread[] {
    return Array.from(this.threads.values());
  }

  /** Return one cached thread without performing transcript I/O. */
  get(threadId: string): EnvoyThread | undefined {
    return this.threads.get(threadId);
  }

  /** Add or replace a cached thread. */
  set(thread: EnvoyThread): void {
    this.threads.set(thread.id, thread);
  }

  /** Read a thread, refreshing diplomacy messages from the durable store first. */
  async read(threadId: string): Promise<EnvoyThread | undefined> {
    const thread = this.threads.get(threadId);
    if (thread?.diplomacy) {
      await this.dependencies.syncDiplomacyThread(thread);
    }
    return thread;
  }

  /** Delete a thread after shutting down any database context it owns. */
  async delete(threadId: string): Promise<boolean> {
    const thread = this.threads.get(threadId);
    if (!thread) return false;

    if (thread.contextType === 'database' && thread.contextId) {
      await this.dependencies.shutdownContext(thread.contextId);
    }

    return this.threads.delete(threadId);
  }
}

/** Shut down a registered database context when it is still active. */
async function shutdownRegisteredContext(contextId: string): Promise<void> {
  const context = contextRegistry.get(contextId);
  if (!context) return;

  await context.shutdown();
  logger.info(`Shut down telepathist context: ${contextId}`);
}

/** Production chat thread cache shared by all agent route modules. */
export const chatThreadStore = new ChatThreadStore({
  syncDiplomacyThread: syncThreadMessages,
  shutdownContext: shutdownRegisteredContext,
});
