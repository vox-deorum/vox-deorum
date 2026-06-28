import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, shallowRef, type Ref } from 'vue';

// Mock the API client so the test drives the streaming callbacks directly.
const api = vi.hoisted(() => ({ streamAgentMessage: vi.fn() }));
vi.mock('@/api/client', () => ({ api }));

import { useThreadMessages } from '@/composables/useThreadMessages';
import type { SendCommitState } from '@/api/client';
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
  let onGreetingFailed: ReturnType<typeof vi.fn>;
  // The streaming callbacks the composable handed to api.streamAgentMessage, captured for driving.
  let cb: { onMessage: (p: any) => void; onError: (m: string, commit: SendCommitState) => void; onDone: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    // shallowRef avoids deep-unwrapping EnvoyThread's ModelMessage union (TS2589); the composable
    // mutates `.value.messages` in place and the test reads it directly, so no deep reactivity is needed.
    thread = shallowRef(makeThread());
    isStreaming = ref(false);
    sessionId = ref('dipl:g:0:1');
    onSendFailed = vi.fn();
    onGreetingFailed = vi.fn();
    api.streamAgentMessage.mockImplementation((_req: any, onMessage: any, onError: any, onDone: any) => {
      cb = { onMessage, onError, onDone };
      return () => {};
    });
  });

  const setup = () => useThreadMessages({ thread, sessionId, isStreaming, onSendFailed, onGreetingFailed });

  it('rolls the optimistic rows back and restores the text on an uncommitted (pre-stream) failure', async () => {
    const { sendMessage } = setup();
    await sendMessage('Will you trade?');

    // Optimistically rendered: the user message + the assistant placeholder.
    expect(thread.value!.messages).toHaveLength(2);
    expect(thread.value!.messages[0]!.message).toMatchObject({ role: 'user', content: 'Will you trade?' });

    // The send was rejected before the server wrote anything (e.g. the live turn was unavailable).
    cb.onError('The live game turn is not available yet.', 'uncommitted');

    // Both optimistic rows are removed, the text is handed back, and streaming clears.
    expect(thread.value!.messages).toHaveLength(0);
    expect(onSendFailed).toHaveBeenCalledWith('Will you trade?', 'The live game turn is not available yet.', 'uncommitted');
    expect(isStreaming.value).toBe(false);
  });

  it('keeps the committed message and drops only the unfinished reply on a committed failure', async () => {
    const { sendMessage } = setup();
    await sendMessage('Hello');

    // A chunk streamed, then the connection failed after the stream had opened. The backend commits the
    // caller's message up front, so it may be on the record — keep it on screen, roll back only the
    // partial assistant row, and do NOT restore the input ('committed') so a retry can't dupe it.
    cb.onMessage({ type: 'text-delta', text: 'Greetin', id: 'a' });
    cb.onError('Failed to execute agent: boom', 'committed');

    expect(thread.value!.messages).toHaveLength(1);
    expect(thread.value!.messages[0]!.message).toMatchObject({ role: 'user', content: 'Hello' });
    expect(onSendFailed).toHaveBeenCalledWith('Hello', 'Failed to execute agent: boom', 'committed');
    expect(isStreaming.value).toBe(false);
  });

  it('keeps the exchange after done and ignores a trailing error', async () => {
    const { sendMessage } = setup();
    await sendMessage('Hi');
    cb.onMessage({ type: 'text-delta', text: 'Hello there', id: 'a' });
    cb.onDone();

    // A stray error after the terminal done must not roll the now-committed exchange back.
    cb.onError('late error', 'committed');

    expect(thread.value!.messages).toHaveLength(2);
    expect(onSendFailed).not.toHaveBeenCalled();
  });

  it('surfaces a greeting failure (not silent) and rolls the placeholder back', async () => {
    const { requestGreeting } = setup();
    await requestGreeting();

    // A greeting has no visible user row — only the assistant placeholder is optimistic.
    expect(thread.value!.messages).toHaveLength(1);

    cb.onError('Could not reach the agent.', 'committed');

    // The empty placeholder is removed and the failure is reported through onGreetingFailed (the host
    // would never know otherwise), with no input to restore. The server drops the trigger so a reload
    // can re-greet.
    expect(thread.value!.messages).toHaveLength(0);
    expect(onGreetingFailed).toHaveBeenCalledWith('Could not reach the agent.');
    expect(onSendFailed).not.toHaveBeenCalled();
    expect(isStreaming.value).toBe(false);
  });
});
