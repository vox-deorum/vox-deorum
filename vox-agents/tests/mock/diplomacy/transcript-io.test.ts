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
  appendTranscriptMessage,
  appendCloseMessage,
  syncThreadMessages,
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
