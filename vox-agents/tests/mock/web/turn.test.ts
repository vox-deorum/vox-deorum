/**
 * @module tests/mock/web/turn
 *
 * Focused lifecycle coverage for the transport-neutral chat turn runner.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { contextRegistry } from '../../../src/infra/context-registry.js';
import type { ChatStreamSink, EnvoyThread } from '../../../src/types/index.js';
import { beginChatTurn } from '../../../src/utils/diplomacy/chat-turn-commit.js';
import { chatThreadStore } from '../../../src/web/chat/store.js';
import { runChatTurn } from '../../../src/web/chat/turn.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('chat turn runner', () => {
  it('should release the turn lock when stream setup throws after commit', async () => {
    const thread: EnvoyThread = {
      id: 'turn-setup-failure',
      agent: 3,
      gameID: 'test',
      player1ID: -1,
      player2ID: 3,
      player1Role: 'Observer',
      player2Role: 'spokesperson',
      contextType: 'live',
      contextId: 'turn-setup-context',
      messages: [],
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        turn: 4,
      },
    };
    chatThreadStore.set(thread);
    vi.spyOn(contextRegistry, 'get').mockReturnValue({
      getBaseParameters: () => ({ turn: 4 }),
    } as never);

    const streamError = vi.fn();
    const sink: ChatStreamSink = {
      connected: () => { throw new Error('socket setup failed'); },
      message: vi.fn(),
      error: streamError,
      done: vi.fn(),
      onDisconnect: vi.fn(),
    };

    try {
      await expect(runChatTurn({ chatId: thread.id, message: 'Hello' }, sink)).resolves.toBeUndefined();
      expect(streamError).toHaveBeenCalledWith({ message: 'Failed to execute agent: socket setup failed' });

      const nextTurn = await beginChatTurn(
        thread,
        { kind: 'text', chatId: thread.id, message: 'Try again' },
        4,
      );
      nextTurn.finish();
    } finally {
      await chatThreadStore.delete(thread.id);
    }
  });
});
