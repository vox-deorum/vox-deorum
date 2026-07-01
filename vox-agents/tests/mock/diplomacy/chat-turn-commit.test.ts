/**
 * @module tests/mock/diplomacy/chat-turn-commit
 *
 * Coverage for `beginChatTurn().complete()` cache normalization (the live-envoy free-text fix). The
 * streaming run leaves the raw assistant messages in the thread cache: native free text (the swallowed
 * tool-force fallback, possibly malformed tool-call junk), the `send-message` tool call, and any
 * negotiator/close handoff. `complete()` must replace that reply slice with exactly what it archived,
 * so a later turn prompts on the same history a reload would hydrate rather than resurfacing the junk
 * the user never saw. Uses the shared mcpClient fixture (no live MCP server / game).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockMcpClient, structuredResult } from '../../helpers/mock-mcp-client.js';
import type { EnvoyThread, MessageWithMetadata } from '../../../src/types/index.js';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { beginChatTurn } from '../../../src/utils/diplomacy/chat-turn-commit.js';
import { retryMessage } from '../../../src/utils/diplomacy/transcript-utils.js';
import { sendMessageToolName } from '../../../src/utils/diplomacy/send-message-tool-name.js';

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
  // Every commit and reply append in these tests resolves to the same stamped turn.
  mcp.respondWith('append-message', structuredResult({ Turn: 5 }));
});

/** Minimal diplomacy thread (ordered pair 1↔3, agent voices seat 3). A fresh id per test keeps the
 *  module-level in-flight lock from leaking across cases even if one forgets to `finish()`. */
function thread(id: string): EnvoyThread {
  return {
    id,
    agent: 3,
    gameID: 'g',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'diplomat',
    diplomacy: true,
    contextType: 'live',
    contextId: 'g-player-3',
    messages: [],
    metadata: {},
  };
}

/** An assistant cache item carrying the given ordered content parts (text / tool-call). */
function assistant(parts: unknown[]): MessageWithMetadata {
  return {
    message: { role: 'assistant', content: parts as never },
    metadata: { datetime: new Date(), turn: 5 },
  };
}

/** The send-message tool-call part the streamer converts back into the spoken bubble. */
const spoke = (message: string) => ({
  type: 'tool-call', toolName: sendMessageToolName, toolCallId: 't1', input: { Message: message },
});
/** A native free-text part: the tool-force fallback / malformed tool-call junk the user never saw. */
const freeText = (text: string) => ({ type: 'text', text });
/** The send-message tool result the run records (the "delivered" confirmation), removed on normalize. */
const sendResult = (): MessageWithMetadata => ({
  message: { role: 'tool', content: [{ type: 'tool-result', toolName: sendMessageToolName, toolCallId: 't1', output: { type: 'text', value: 'Message delivered.' } }] as never },
  metadata: { datetime: new Date(), turn: 5 },
});

describe('beginChatTurn().complete() cache normalization', () => {
  it('replaces the reply slice with the archived send-message text, dropping suppressed free text', async () => {
    const t = thread('dipl:g:1:3#a');
    const turn = await beginChatTurn(t, { kind: 'text', message: 'Greetings.' }, 5);
    // Simulate the run persisting its raw steps: junk free text BEFORE and AFTER the real spoken line.
    t.messages.push(
      assistant([freeText('<|tool_call|>{"name":"send-message"} '), spoke('Peace to you, neighbor.')]),
      sendResult(),
      assistant([freeText('}}> trailing junk')]),
    );

    await turn.complete({ sendMessageOnly: true });
    turn.finish();

    // The cache now holds only the committed user row plus a single normalized assistant text row.
    expect(t.messages).toHaveLength(2);
    expect(t.messages[0].message).toEqual({ role: 'user', content: 'Greetings.' });
    expect(t.messages[1].message).toEqual({ role: 'assistant', content: 'Peace to you, neighbor.' });
    // The archived reply matches the normalized cache row exactly (live == reload).
    const appends = mcp.calls('append-message');
    expect(appends).toHaveLength(2);
    expect(appends[1].args).toMatchObject({ SpeakerID: 3, MessageType: 'text', Content: 'Peace to you, neighbor.' });
    // No malformed free text survives anywhere in the cache.
    expect(JSON.stringify(t.messages)).not.toContain('tool_call');
    expect(JSON.stringify(t.messages)).not.toContain('trailing junk');
  });

  it('removes the negotiator handoff from the cache and archives no reply row (terminal action)', async () => {
    const t = thread('dipl:g:1:3#b');
    const turn = await beginChatTurn(t, { kind: 'text', message: 'Here is my offer.' }, 5);
    // A deal turn ends at the negotiator handoff (a terminal action), with no spoken send-message line.
    t.messages.push(
      assistant([{ type: 'tool-call', toolName: 'call-negotiator', toolCallId: 'n1', input: {} }]),
      { message: { role: 'tool', content: [{ type: 'tool-result', toolName: 'call-negotiator', toolCallId: 'n1', output: { type: 'text', value: 'handled' } }] as never }, metadata: { datetime: new Date(), turn: 5 } },
    );

    await turn.complete({ sendMessageOnly: true });
    turn.finish();

    // Only the committed user row remains; the ephemeral handoff plumbing is gone (a reload would not
    // hydrate it either). The route splices the durable deal rows in at this boundary afterward.
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0].message).toEqual({ role: 'user', content: 'Here is my offer.' });
    // Only the commit append fired; a terminal-action turn archives no "lost my train of thought" line.
    expect(mcp.calls('append-message')).toHaveLength(1);
  });

  it('falls back to the shared retry line when the turn spoke only suppressed free text', async () => {
    const t = thread('dipl:g:1:3#c');
    const turn = await beginChatTurn(t, { kind: 'text', message: 'Well?' }, 5);
    // The turn produced only native free text (no send-message, no terminal action): a stuck turn.
    t.messages.push(assistant([freeText('<|tool_call|> garbled and nothing usable')]));

    await turn.complete({ sendMessageOnly: true });
    turn.finish();

    expect(t.messages).toHaveLength(2);
    expect(t.messages[1].message).toEqual({ role: 'assistant', content: retryMessage });
    const appends = mcp.calls('append-message');
    expect(appends).toHaveLength(2);
    expect(appends[1].args).toMatchObject({ MessageType: 'text', Content: retryMessage });
  });
});
