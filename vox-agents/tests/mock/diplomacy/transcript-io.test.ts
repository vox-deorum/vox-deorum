/**
 * Tests for the diplomacy transcript I/O wrappers (src/utils/diplomacy/transcript.ts),
 * the write-through layer between vox-agents chat threads and the durable mcp-server store.
 * Uses the shared mcpClient fixture — no live MCP server / game.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockMcpClient, structuredResult } from '../../helpers/mock-mcp-client.js';
import type { EnvoyThread } from '../../../src/types/index.js';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import {
  readTranscript,
  readTranscriptPage,
  appendTranscriptMessage,
  appendTranscriptMessageRow,
  appendCloseMessage,
  syncThreadMessages,
  autoCompact,
  maybeAutoCompact,
} from '../../../src/utils/diplomacy/transcript.js';

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
});

/** Minimal diplomacy thread (ordered pair 1↔3, agent voices seat 3). */
function thread(partial: Partial<EnvoyThread> = {}): EnvoyThread {
  return {
    id: 'dipl:g:1:3',
    agent: 3,
    gameID: 'g',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'diplomat',
    contextType: 'live',
    contextId: 'g-player-3',
    messages: [],
    ...partial,
  };
}

describe('readTranscript', () => {
  it('passes both endpoints and unwraps structuredContent', async () => {
    const rows = [{ ID: 1, Content: 'hi' }];
    mcp.respondWith('read-transcript', structuredResult({ messages: rows }));

    const result = await readTranscript(3, 1);

    expect(result).toEqual(rows);
    expect(mcp.calls('read-transcript')[0].args).toEqual({ PlayerAID: 3, PlayerBID: 1 });
  });

  it('accepts a bare object response (no structuredContent wrapper)', async () => {
    const rows = [{ ID: 2 }];
    mcp.respondWith('read-transcript', { messages: rows });
    expect(await readTranscript(1, 3)).toEqual(rows);
  });

  it('returns [] when messages is not an array', async () => {
    mcp.respondWith('read-transcript', structuredResult({ messages: { not: 'an array' } }));
    expect(await readTranscript(1, 3)).toEqual([]);
  });
});

describe('readTranscriptPage', () => {
  it('passes optional paging arguments and returns the durable continuation metadata', async () => {
    const rows = [{ ID: 8, Content: 'older row' }];
    mcp.respondWith('read-transcript', structuredResult({ messages: rows, hasMore: true, NextBeforeID: 8 }));

    const page = await readTranscriptPage(1, 3, { beforeID: 12, limit: 4 });

    expect(mcp.calls('read-transcript')[0].args).toEqual({
      PlayerAID: 1, PlayerBID: 3, BeforeID: 12, Limit: 4,
    });
    expect(page).toEqual({ messages: rows, hasMore: true, nextBeforeID: 8 });
  });

  it('omits absent paging arguments and normalizes missing metadata', async () => {
    mcp.respondWith('read-transcript', structuredResult({ messages: [] }));

    expect(await readTranscriptPage(1, 3)).toEqual({ messages: [], hasMore: false });
    expect(mcp.calls('read-transcript')[0].args).toEqual({ PlayerAID: 1, PlayerBID: 3 });
  });
});

describe('appendTranscriptMessage', () => {
  it('never sends Turn and shapes the row from the thread', async () => {
    mcp.respondWith('append-message', structuredResult({ Turn: 7 }));

    const stamped = await appendTranscriptMessage(thread(), 1, 'text', 'hello there');

    expect(stamped).toBe(7);
    const args = mcp.calls('append-message')[0].args;
    expect(args).toEqual({
      PlayerAID: 1,
      PlayerBID: 3,
      PlayerARole: 'the leader',
      PlayerBRole: 'diplomat',
      SpeakerID: 1,
      MessageType: 'text',
      Content: 'hello there',
    });
    expect(args).not.toHaveProperty('Turn');
  });

  it('returns undefined when the response omits a numeric Turn', async () => {
    mcp.respondWith('append-message', structuredResult({ ID: 5 }));
    expect(await appendTranscriptMessage(thread(), 3, 'text', 'reply')).toBeUndefined();
  });
});

describe('appendTranscriptMessageRow', () => {
  it('returns the committed row projection used by the game transport', async () => {
    const committed = {
      ID: 17, SpeakerID: 3, MessageType: 'text', Content: 'A **durable** reply.',
      Payload: { source: 'probe' }, Turn: 11,
    };
    mcp.respondWith('append-message', structuredResult(committed));

    await expect(appendTranscriptMessageRow(thread(), 3, committed.Content)).resolves.toEqual(committed);
    expect(mcp.calls('append-message')[0].args).toEqual({
      PlayerAID: 1, PlayerBID: 3, PlayerARole: 'the leader', PlayerBRole: 'diplomat',
      SpeakerID: 3, MessageType: 'text', Content: committed.Content,
    });
  });
});

describe('syncThreadMessages', () => {
  /** A stored transcript row with sensible defaults for the ordered pair 1↔3. */
  const row = (over: Record<string, unknown>) => ({
    ID: 1, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
    SpeakerID: 1, MessageType: 'text', Content: '', Payload: {}, Turn: 1, CreatedAt: 0, ...over,
  });

  it('re-hydrates the thread from the store: text + deal rows inline, in append order', async () => {
    mcp.respondWith('read-transcript', structuredResult({ messages: [
      row({ ID: 1, SpeakerID: 1, MessageType: 'text', Content: 'hello', Turn: 5, CreatedAt: 2 }),
      row({ ID: 2, SpeakerID: 3, MessageType: 'deal-proposal', Content: 'deal', Turn: 5,
        Payload: { Deal: { version: 1, items: [], promises: [] } } }),
      row({ ID: 3, SpeakerID: 3, MessageType: 'close', Content: 'bye', Turn: 6 }),
    ] }));
    const t = thread();

    await syncThreadMessages(t);

    // Reads the thread's ordered pair, and replaces messages in store append order.
    expect(mcp.calls('read-transcript')[0].args).toEqual({ PlayerAID: 1, PlayerBID: 3 });
    expect(t.messages.map((m) => m.message.content)).toEqual(['hello', 'deal', 'bye']);
    // The deal row carries its payload for inline rendering/reduction; plain rows don't.
    expect(t.messages[1].deal?.MessageType).toBe('deal-proposal');
    expect(t.messages[0].deal).toBeUndefined();
  });

  it('carries the memory-only native trace over onto the matching rehydrated rows', async () => {
    const trace = [{ role: 'assistant', content: [{ type: 'reasoning', text: 'hold firm' }] }];
    const t = thread({
      messages: [
        { message: { role: 'user', content: 'offer?' }, metadata: { datetime: new Date(0), turn: 5, id: 1 } },
        // The normalized reply row carrying the trace; the store stamped a different turn (6 vs 5).
        { message: { role: 'assistant', content: 'We decline.' }, metadata: { datetime: new Date(0), turn: 5, trace: trace as never } },
        // A second reply with the SAME text but no trace: in-order matching must not steal for it.
        { message: { role: 'assistant', content: 'We decline.' }, metadata: { datetime: new Date(0), turn: 5 } },
      ],
    });
    mcp.respondWith('read-transcript', structuredResult({ messages: [
      row({ ID: 1, SpeakerID: 1, Content: 'offer?', Turn: 5 }),
      row({ ID: 2, SpeakerID: 3, Content: 'We decline.', Turn: 6 }),
      row({ ID: 3, SpeakerID: 3, Content: 'We decline.', Turn: 6 }),
    ] }));

    await syncThreadMessages(t);

    // The trace landed on the FIRST matching rehydrated row (in-order consumption), despite the
    // store-stamped turn differing from the live snapshot the cache row was created with.
    expect(t.messages[1].metadata.trace).toEqual(trace);
    expect(t.messages[2].metadata.trace).toBeUndefined();
    expect(t.messages[0].metadata.trace).toBeUndefined();
  });

  it('autoCompact folds the ongoing exchange into the past by advancing the open mark', async () => {
    const trace = [{ role: 'assistant', content: [{ type: 'reasoning', text: 'x' }] }];
    const t = thread({
      pastMessageID: 1,
      messages: [
        { message: { role: 'user', content: 'offer?' }, metadata: { datetime: new Date(0), turn: 5, id: 1 } },
        // A live-pushed reply carrying an in-memory trace (no store id yet) — the ongoing exchange.
        { message: { role: 'assistant', content: 'We decline.' }, metadata: { datetime: new Date(0), turn: 5, trace: trace as never } },
      ],
    });
    mcp.respondWith('read-transcript', structuredResult({ messages: [
      row({ ID: 1, SpeakerID: 1, Content: 'offer?', Turn: 5 }),
      row({ ID: 2, SpeakerID: 3, Content: 'We decline.', Turn: 6 }),
    ] }));

    await autoCompact(t);

    // Re-synced from the store, and the mark advanced to the last hydrated row: every row is now past,
    // so the next run renders the compiled past block with no replayed native trace.
    expect(t.messages.map((m) => m.metadata.id)).toEqual([1, 2]);
    expect(t.pastMessageID).toBe(2);
    // The retained fat is genuinely shed (not merely left inert): traces are NOT carried back over.
    expect(t.messages.every((m) => m.metadata.trace === undefined)).toBe(true);
  });

  it('derives the close turn from the latest close row', async () => {
    mcp.respondWith('read-transcript', structuredResult({ messages: [
      row({ ID: 1, MessageType: 'text', Turn: 4 }),
      row({ ID: 2, MessageType: 'close', Turn: 8 }),
    ] }));
    const t = thread();

    await syncThreadMessages(t);

    expect(t.closeTurn).toBe(8);
  });
});

describe('appendCloseMessage', () => {
  it('records the server-stamped turn on the thread and returns it', async () => {
    mcp.respondWith('append-message', structuredResult({ Turn: 12 }));
    const t = thread();

    const turn = await appendCloseMessage(t, t.agent, 'farewell', 99);

    expect(turn).toBe(12);
    expect(t.closeTurn).toBe(12);
    expect(mcp.calls('append-message')[0].args.MessageType).toBe('close');
  });

  it('falls back to fallbackTurn when the response omits Turn', async () => {
    mcp.respondWith('append-message', structuredResult({ ID: 1 }));
    const t = thread();

    const turn = await appendCloseMessage(t, t.agent, 'farewell', 42);

    expect(turn).toBe(42);
    expect(t.closeTurn).toBe(42);
  });
});

describe('maybeAutoCompact (token gate)', () => {
  const row = (over: Record<string, unknown>) => ({
    ID: 1, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
    SpeakerID: 1, MessageType: 'text', Content: '', Payload: {}, Turn: 1, CreatedAt: 0, ...over,
  });
  const withOngoing = () => thread({
    diplomacy: true,
    pastMessageID: 1,
    messages: [
      { message: { role: 'user', content: 'offer?' }, metadata: { datetime: new Date(0), turn: 5, id: 1 } },
      // Live-pushed reply (no store id): the ongoing exchange the gate measures.
      { message: { role: 'assistant', content: 'We decline.' }, metadata: { datetime: new Date(0), turn: 5 } },
    ],
  });

  it('is a pure estimate under the limit: no store read, no compaction', async () => {
    const t = withOngoing();
    await maybeAutoCompact(t, 1_000_000);
    expect(t.pastMessageID).toBe(1);
    expect(t.messages).toHaveLength(2);
    expect(mcp.calls('read-transcript')).toHaveLength(0);
  });

  it('auto-compacts when the ongoing exchange exceeds the limit', async () => {
    const t = withOngoing();
    mcp.respondWith('read-transcript', structuredResult({ messages: [
      row({ ID: 1, SpeakerID: 1, Content: 'offer?', Turn: 5 }),
      row({ ID: 2, SpeakerID: 3, Content: 'We decline.', Turn: 6 }),
    ] }));

    await maybeAutoCompact(t, 1); // a 1-token ceiling forces the gate

    expect(t.pastMessageID).toBe(2);
    expect(t.messages.map((m) => m.metadata.id)).toEqual([1, 2]);
  });

  it('is a no-op for non-diplomacy threads', async () => {
    const t = thread({ diplomacy: false, messages: [
      { message: { role: 'user', content: 'x' }, metadata: { datetime: new Date(0), turn: 5 } },
    ] });
    await maybeAutoCompact(t, 1);
    expect(mcp.calls('read-transcript')).toHaveLength(0);
  });
});
