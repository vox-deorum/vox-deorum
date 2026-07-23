import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, shallowRef, type Ref } from 'vue';

// Mock the API client so the test drives the streaming callbacks directly.
const api = vi.hoisted(() => ({ streamAgentMessage: vi.fn(), getDealMessages: vi.fn() }));
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
  let onDealFailed: ReturnType<typeof vi.fn>;
  // The streaming callbacks the composable handed to api.streamAgentMessage, captured for driving.
  let cb: {
    onMessage: (p: any) => void;
    onError: (m: string, commit: SendCommitState) => void;
    onDone: (data?: any) => void;
    onConnected: (data: any) => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // shallowRef avoids deep-unwrapping EnvoyThread's ModelMessage union (TS2589); the composable
    // mutates `.value.messages` in place and the test reads it directly, so no deep reactivity is needed.
    thread = shallowRef(makeThread());
    isStreaming = ref(false);
    sessionId = ref('dipl:g:0:1');
    onSendFailed = vi.fn();
    onGreetingFailed = vi.fn();
    onDealFailed = vi.fn();
    api.streamAgentMessage.mockImplementation((_req: any, onMessage: any, onError: any, onDone: any, onConnected: any) => {
      cb = { onMessage, onError, onDone, onConnected };
      return () => {};
    });
  });

  const setup = () => useThreadMessages({ thread, sessionId, isStreaming, onSendFailed, onGreetingFailed, onDealFailed });

  const emptyDeal = () => ({ version: 1, items: [], promises: [] }) as any;

  /** An authoritative committed deal row as the server emits it on the `connected` event. */
  const dealRow = (over: Record<string, any> = {}) => ({
    ID: 42, Player1ID: 0, Player2ID: 1, Player1Role: 'the leader', Player2Role: 'diplomat',
    SpeakerID: 0, MessageType: 'deal-proposal', Content: 'note',
    Payload: { Deal: emptyDeal(), Value1: {}, Value2: {} },
    Turn: 5, CreatedAt: 1700000000, ...over,
  }) as any;

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
    expect(isStreaming.value).toBe(false);
  });

  it('replaces preliminary tool progress by call ID and preserves provenance', async () => {
    const onNewChunk = vi.fn();
    const { sendMessage } = useThreadMessages({
      thread,
      sessionId,
      isStreaming,
      onNewChunk,
      onSendFailed,
      onGreetingFailed,
      onDealFailed,
    });
    await sendMessage('Inspect the map');
    cb.onMessage({
      type: 'tool-call',
      toolCallId: 'host-1',
      toolName: 'command',
      input: { command: 'dir' },
      providerExecuted: true,
      dynamic: true,
    });
    cb.onMessage({
      type: 'tool-result',
      toolCallId: 'host-1',
      toolName: 'command',
      output: { status: 'started', progress: 'starting' },
      providerExecuted: true,
      dynamic: true,
    });
    cb.onMessage({
      type: 'tool-result',
      toolCallId: 'host-1',
      toolName: 'command',
      output: { status: 'in_progress', progress: 'working' },
      providerExecuted: true,
      dynamic: true,
    });
    cb.onMessage({
      type: 'tool-result',
      toolCallId: 'host-1',
      toolName: 'command',
      output: { status: 'completed', exitCode: 0 },
      providerExecuted: true,
      dynamic: true,
      preliminary: false,
    });

    const content = thread.value!.messages[1]!.message.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0]).toMatchObject({
      type: 'tool-call',
      toolCallId: 'host-1',
      providerExecuted: true,
      dynamic: true,
    });
    expect(content[1]).toMatchObject({
      type: 'tool-result',
      toolCallId: 'host-1',
      output: { status: 'completed', exitCode: 0 },
      providerExecuted: true,
      dynamic: true,
      preliminary: false,
    });
    expect(onNewChunk).toHaveBeenCalledTimes(3);
  });

  it('replaces progress with a terminal tool error', async () => {
    const { sendMessage } = setup();
    await sendMessage('Inspect the map');
    cb.onMessage({
      type: 'tool-result',
      toolCallId: 'host-2',
      toolName: 'web-search',
      output: { status: 'in_progress' },
      providerExecuted: true,
      dynamic: true,
      preliminary: true,
    });
    cb.onMessage({
      type: 'tool-error',
      toolCallId: 'host-2',
      toolName: 'web-search',
      error: { message: 'search failed' },
      providerExecuted: true,
      dynamic: true,
    });

    const content = thread.value!.messages[1]!.message.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({
      type: 'tool-error',
      toolCallId: 'host-2',
      error: { message: 'search failed' },
      providerExecuted: true,
      dynamic: true,
    });
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

  it('proposeDeal inserts the authoritative card on `connected` and reuses the streaming chat endpoint', async () => {
    const { proposeDeal } = setup();
    const deal = { version: 1, items: [{ fromPlayerID: 0, toPlayerID: 1, itemType: 'OPEN_BORDERS' }], promises: [] } as any;
    const onConnected = vi.fn();
    await proposeDeal(deal, onConnected);

    // No optimistic/sentinel card — before `connected`, only the reply placeholder exists.
    expect(thread.value!.messages).toHaveLength(1);
    expect(thread.value!.messages[0]!.deal).toBeUndefined();

    // It streams through the SAME endpoint as a chat message, with a `kind`-tagged deal body (no content).
    expect(api.streamAgentMessage).toHaveBeenCalledTimes(1);
    expect(api.streamAgentMessage.mock.calls[0]![0]).toEqual({
      kind: 'deal', chatId: 'dipl:g:0:1', deal,
    });

    // The server committed the turn: `connected` carries the authoritative row, which lands as the card
    // BEFORE the reply placeholder, and the host's close callback fires.
    cb.onConnected({ sessionId: 'dipl:g:0:1', deal: dealRow({ Payload: { Deal: deal } }) });
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(thread.value!.messages).toHaveLength(2);
    const card = thread.value!.messages[0]!.deal!;
    expect(card.ID).toBe(42);                      // real ID — no sentinel
    expect(card.MessageType).toBe('deal-proposal');
    expect(card.Payload.Deal).toEqual(deal);
  });

  it('proposeDeal keeps the dialog open (no card, no close) on an uncommitted (pre-connected) failure', async () => {
    const { proposeDeal } = setup();
    const onConnected = vi.fn();
    await proposeDeal(emptyDeal(), onConnected);
    expect(thread.value!.messages).toHaveLength(1); // the reply placeholder only

    // Rejected before `connected` (illegal/uninspectable deal, busy, close-lock): nothing committed.
    cb.onError('Could not inspect deal before storing proposal: game down', 'uncommitted');

    expect(thread.value!.messages).toHaveLength(0); // placeholder removed
    expect(onConnected).not.toHaveBeenCalled();     // dialog never closed → draft intact
    expect(onDealFailed).toHaveBeenCalledWith('Could not inspect deal before storing proposal: game down', 'uncommitted');
    expect(isStreaming.value).toBe(false);
  });

  it('proposeDeal keeps the committed card and drops only the unfinished reply on a committed failure', async () => {
    const { proposeDeal } = setup();
    await proposeDeal(emptyDeal(), vi.fn(), 7);

    // A counter forwards the open proposal's ID so the server can reconcile the submission to it (and
    // derive the deal-counter type) under the turn lock.
    expect(api.streamAgentMessage.mock.calls[0]![0]).toMatchObject({
      kind: 'deal', expectedProposalID: 7,
    });

    cb.onConnected({ deal: dealRow({ MessageType: 'deal-counter' }) });
    cb.onMessage({ type: 'text-delta', text: 'partial', id: 'a' });
    cb.onError('reply failed', 'committed');

    // The proposal committed durably (its authoritative card arrived on `connected`), so the card stays;
    // only the partial reply is dropped.
    expect(thread.value!.messages).toHaveLength(1);
    expect(thread.value!.messages[0]!.deal!.MessageType).toBe('deal-counter');
    expect(thread.value!.messages[0]!.deal!.ID).toBe(42);
    expect(onDealFailed).toHaveBeenCalledWith('reply failed', 'committed');
    expect(isStreaming.value).toBe(false);
  });

  it('proposeDeal keeps the card and the streamed reply after done', async () => {
    const { proposeDeal } = setup();
    await proposeDeal(emptyDeal(), vi.fn());
    cb.onConnected({ deal: dealRow() });
    cb.onMessage({ type: 'text-delta', text: 'Agreed', id: 'a' });
    cb.onDone({});

    expect(thread.value!.messages).toHaveLength(2); // authoritative card + streamed reply
    expect(thread.value!.messages[0]!.deal!.ID).toBe(42);
    expect(isStreaming.value).toBe(false);
  });

  it("folds the diplomat's mid-run deal rows (carried on `done`) in AFTER the streamed reply", async () => {
    const { proposeDeal } = setup();
    await proposeDeal(emptyDeal(), vi.fn());
    cb.onConnected({ deal: dealRow() });                            // the caller's proposal card (ID 42)
    cb.onMessage({ type: 'text-delta', text: 'We counter.', id: 'a' });
    // The diplomat countered mid-run; the server reconciled it and sends the authoritative row on `done`.
    cb.onDone({ deals: [dealRow({ ID: 43, MessageType: 'deal-counter' })] });

    // proposal card (42) + streamed reply + the diplomat's counter (43) — the counter is appended AFTER
    // the reply (the reasoning/tool block that produced it), reading as its OUTCOME; dedup keeps 42 once;
    // no reload.
    expect(thread.value!.messages).toHaveLength(3);
    expect(thread.value!.messages[0]!.deal!.ID).toBe(42);    // the caller's proposal card stays first
    expect(thread.value!.messages[1]!.deal).toBeUndefined(); // the streamed reply precedes the mid-run card
    expect(thread.value!.messages[2]!.deal!.ID).toBe(43);
    expect(thread.value!.messages[2]!.deal!.MessageType).toBe('deal-counter');
    expect(isStreaming.value).toBe(false);
  });

  it('reconciles the committed proposal and closes the dialog when a drop loses its `connected` card', async () => {
    // The proposal commits durably but the connection drops BEFORE delivering its authoritative row (the
    // `connected` event was lost). No card was ever inserted and the dialog is still open — so the client
    // must re-read the committed row from the store, fold it in, and close the dialog so the human doesn't
    // unknowingly re-send a duplicate of an offer that already landed.
    api.getDealMessages.mockResolvedValue({ messages: [dealRow({ ID: 50 })] });
    const { proposeDeal } = setup();
    const onConnected = vi.fn();
    await proposeDeal(emptyDeal(), onConnected);
    expect(thread.value!.messages).toHaveLength(1); // reply placeholder only; no card yet

    // The stream opened (so 'committed') then dropped before `connected` — no card was ever received.
    cb.onError('The connection to the server was lost.', 'committed');
    await vi.waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));

    // The committed proposal is re-read from the store and folded in; the dialog is closed.
    expect(api.getDealMessages).toHaveBeenCalledWith('dipl:g:0:1');
    const cards = thread.value!.messages.filter((m) => m.deal);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.deal!.ID).toBe(50);
    expect(onDealFailed).toHaveBeenCalledWith('The connection to the server was lost.', 'committed');
    expect(isStreaming.value).toBe(false);
  });

  it('appends multiple mid-run rows (accept then enacted) after the reasoning/handoff block, in order', async () => {
    // The screenshot case: the human proposes, the diplomat reasons and hands off to the negotiator
    // (call-negotiator is terminal, so no spoken reply follows), and the negotiator accepts + enacts.
    // Both authoritative rows arrive on `done` and must land AFTER the reasoning/tool block that produced
    // them — reading as its outcome — preserving the server's append order between themselves.
    const { proposeDeal } = setup();
    await proposeDeal(emptyDeal(), vi.fn());
    cb.onConnected({ deal: dealRow() });                              // the caller's proposal card (ID 42)
    cb.onMessage({ type: 'reasoning-delta', text: 'Weighing the embassy exchange.', id: 'r' });
    cb.onMessage({ type: 'tool-call', toolCallId: 't1', toolName: 'call-negotiator', input: {} });
    cb.onDone({ deals: [
      dealRow({ ID: 43, MessageType: 'deal-accept' }),
      dealRow({ ID: 44, MessageType: 'deal-enacted' }),
    ] });

    // proposal (42) → the reasoning/handoff reply → accept (43) → enacted (44).
    expect(thread.value!.messages).toHaveLength(4);
    expect(thread.value!.messages[0]!.deal!.ID).toBe(42);
    expect(thread.value!.messages[1]!.deal).toBeUndefined();         // the ephemeral reasoning/tool block
    expect(thread.value!.messages[2]!.deal!.MessageType).toBe('deal-accept');
    expect(thread.value!.messages[3]!.deal!.MessageType).toBe('deal-enacted');
    expect(isStreaming.value).toBe(false);
  });

  it("appends a text turn's mid-run counter after the reply (no connected proposal card)", async () => {
    // A plain chat message the diplomat answers with a negotiator handoff: no deal rides on `connected`,
    // the mid-run counter arrives on `done`, and it must follow the reasoning/handoff block — not slot in
    // between the user's message and that block.
    const { sendMessage } = setup();
    await sendMessage('Will you trade?');
    expect(thread.value!.messages).toHaveLength(2);                  // user message + assistant placeholder
    cb.onConnected({});                                              // a text turn carries no deal
    cb.onMessage({ type: 'reasoning-delta', text: 'They want a trade.', id: 'r' });
    cb.onMessage({ type: 'tool-call', toolCallId: 't1', toolName: 'call-negotiator', input: {} });
    cb.onDone({ deals: [dealRow({ ID: 50, MessageType: 'deal-counter', SpeakerID: 1 })] });

    // user message → the reasoning/handoff reply → counter (50).
    expect(thread.value!.messages).toHaveLength(3);
    expect(thread.value!.messages[0]!.message).toMatchObject({ role: 'user', content: 'Will you trade?' });
    expect(thread.value!.messages[1]!.deal).toBeUndefined();
    expect(thread.value!.messages[2]!.deal!.ID).toBe(50);
    expect(thread.value!.messages[2]!.deal!.MessageType).toBe('deal-counter');
    expect(isStreaming.value).toBe(false);
  });
});
