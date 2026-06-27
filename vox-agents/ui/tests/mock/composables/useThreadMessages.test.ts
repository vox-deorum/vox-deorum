import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, shallowRef, type Ref } from 'vue';

// Mock the API client so the test drives the streaming callbacks directly.
const api = vi.hoisted(() => ({ streamAgentMessage: vi.fn() }));
vi.mock('@/api/client', () => ({ api }));

import { useThreadMessages } from '@/composables/useThreadMessages';
import type { EnvoyThread } from '@/utils/types';

/** A minimal live diplomacy thread with no messages yet. */
const makeThread = (): EnvoyThread => ({
  id: 'dipl:g:0:1', agent: 1, title: 't', gameID: 'g',
  player1ID: 0, player2ID: 1, player1Role: 'the leader', player2Role: 'diplomat',
  diplomacy: true, contextType: 'live', contextId: 'g-player-1', messages: [],
  metadata: { createdAt: new Date(), updatedAt: new Date(), turn: 5 },
} as any);

describe('useThreadMessages', () => {
  let thread: Ref<EnvoyThread | null>;
  let isStreaming: Ref<boolean>;
  let sessionId: Ref<string>;
  let onSendFailed: ReturnType<typeof vi.fn>;
  // The streaming callbacks the composable handed to api.streamAgentMessage, captured for driving.
  let cb: { onMessage: (p: any) => void; onError: (m: string, i: { recoverable: boolean }) => void; onDone: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    // shallowRef avoids deep-unwrapping EnvoyThread's ModelMessage union (TS2589); the composable
    // mutates `.value.messages` in place and the test reads it directly, so no deep reactivity is needed.
    thread = shallowRef(makeThread());
    isStreaming = ref(false);
    sessionId = ref('dipl:g:0:1');
    onSendFailed = vi.fn();
    api.streamAgentMessage.mockImplementation((_req: any, onMessage: any, onError: any, onDone: any) => {
      cb = { onMessage, onError, onDone };
      return () => {};
    });
  });

  const setup = () => useThreadMessages({ thread, sessionId, isStreaming, onSendFailed });

  it('rolls the optimistic rows back and returns the text on a recoverable send failure', async () => {
    const { sendMessage } = setup();
    await sendMessage('Will you trade?');

    // Optimistically rendered: the user message + the assistant placeholder.
    expect(thread.value!.messages).toHaveLength(2);
    expect(thread.value!.messages[0]!.message).toMatchObject({ role: 'user', content: 'Will you trade?' });

    // The route rejected before the stream opened (e.g. the live turn was unavailable).
    cb.onError('The live game turn is not available yet.', { recoverable: true });

    // Both optimistic rows are removed, the text is handed back, and streaming clears.
    expect(thread.value!.messages).toHaveLength(0);
    expect(onSendFailed).toHaveBeenCalledWith('Will you trade?', 'The live game turn is not available yet.');
    expect(isStreaming.value).toBe(false);
  });

  it('keeps the message and shows the error inline when the reply fails mid-stream', async () => {
    const { sendMessage } = setup();
    await sendMessage('Hello');

    // A chunk streamed first, then the reply errored → not recoverable (the message was committed).
    cb.onMessage({ type: 'text-delta', text: 'Greetin', id: 'a' });
    cb.onError('Failed to execute agent: boom', { recoverable: false });

    // The user message + assistant reply (now carrying the inline error) remain; nothing is returned.
    expect(thread.value!.messages).toHaveLength(2);
    expect(onSendFailed).not.toHaveBeenCalled();
    expect(JSON.stringify(thread.value!.messages[1]!.message.content)).toContain('Failed to execute agent: boom');
  });
});
