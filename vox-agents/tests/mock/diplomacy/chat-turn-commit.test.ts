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

import { beginChatTurn, isThreadBusy } from '../../../src/utils/diplomacy/chat-turn-commit.js';
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
  it('reports the thread busy only while a turn owns its lock', async () => {
    const t = thread('dipl:g:1:3#busy');
    expect(isThreadBusy(t.id)).toBe(false);

    const turn = await beginChatTurn(t, { kind: 'text', message: 'Greetings.' }, 5);
    expect(isThreadBusy(t.id)).toBe(true);

    turn.finish();
    expect(isThreadBusy(t.id)).toBe(false);
  });

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

  it('rescues the full native trajectory onto the normalized reply row, never into the archive', async () => {
    const t = thread('dipl:g:1:3#r');
    const turn = await beginChatTurn(t, { kind: 'text', message: 'Thoughts?' }, 5);
    const think = (text: string, signature?: string) => ({
      type: 'reasoning', text, ...(signature ? { providerOptions: { anthropic: { signature } } } : {}),
    });
    // Two steps: a get-briefing step, then the spoken reply. One empty placeholder reasoning part
    // rides along, as some providers emit.
    t.messages.push(
      assistant([think('They sound conciliatory.', 'sig-1'), { type: 'tool-call', toolName: 'get-briefing', toolCallId: 'b1', input: {} }]),
      { message: { role: 'tool', content: [{ type: 'tool-result', toolName: 'get-briefing', toolCallId: 'b1', output: { type: 'text', value: 'Military: strong.' } }] as never }, metadata: { datetime: new Date(), turn: 5 } },
      assistant([think(''), think('We can press our advantage.'), spoke('Let us speak plainly.')]),
      sendResult(),
    );

    await turn.complete({ sendMessageOnly: true });
    turn.finish();

    expect(t.messages).toHaveLength(2);
    const reply = t.messages[1];
    expect(reply.message).toEqual({ role: 'assistant', content: 'Let us speak plainly.' });
    // The trace replays the model's ACTUAL trajectory: signed reasoning, the get-briefing use paired
    // with its result, then the send-message step reduced to its reasoning (the spoken text IS the
    // reply row). Empty placeholders dropped; the send-message call/result never enter the trace.
    expect(reply.metadata.trace).toEqual([
      { role: 'assistant', content: [
        { type: 'reasoning', text: 'They sound conciliatory.', providerOptions: { anthropic: { signature: 'sig-1' } } },
        { type: 'tool-call', toolName: 'get-briefing', toolCallId: 'b1', input: {} },
      ] },
      { role: 'tool', content: [
        { type: 'tool-result', toolName: 'get-briefing', toolCallId: 'b1', output: { type: 'text', value: 'Military: strong.' } },
      ] },
      { role: 'assistant', content: [{ type: 'reasoning', text: 'We can press our advantage.' }] },
    ]);
    expect(JSON.stringify(reply.metadata.trace)).not.toContain('send-message');
    // The durable archive stays reply-text-only: no trace ever reaches mcp-server.
    const appends = mcp.calls('append-message');
    expect(appends).toHaveLength(2);
    expect(JSON.stringify(appends[1].args)).not.toContain('reasoning');
    expect(JSON.stringify(appends[1].args)).not.toContain('get-briefing');
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

  it('collapses a multi-step turn that never spoke to just the retry line — no transient tool rows cached', async () => {
    const t = thread('dipl:g:1:3#retry-multi');
    const turn = await beginChatTurn(t, { kind: 'text', message: 'Well?' }, 5);
    // A multi-step run that gathered a briefing but never produced a send-message reply (stuck turn).
    t.messages.push(
      assistant([{ type: 'tool-call', toolName: 'get-briefing', toolCallId: 'b1', input: {} }]),
      { message: { role: 'tool', content: [{ type: 'tool-result', toolName: 'get-briefing', toolCallId: 'b1', output: { type: 'text', value: 'Military: strong.' } }] as never }, metadata: { datetime: new Date(), turn: 5 } },
      assistant([freeText('<|tool_call|> garbled, nothing usable')]),
    );

    await turn.complete({ sendMessageOnly: true });
    turn.finish();

    // Exactly the committed user row + the single archived retry line remain; the briefing tool traffic
    // — which must never anchor the prompt cache — is collapsed away.
    expect(t.messages).toHaveLength(2);
    expect(t.messages[1].message).toEqual({ role: 'assistant', content: retryMessage });
    expect(JSON.stringify(t.messages)).not.toContain('get-briefing');
    expect(JSON.stringify(t.messages)).not.toContain('Military: strong.');
  });

  it('rolls back an incomplete run, leaving no transient rows in the cache (never cached)', async () => {
    const t = thread('dipl:g:1:3#fail');
    const turn = await beginChatTurn(t, { kind: 'text', message: 'Your terms?' }, 5);
    // A multi-step run in progress — a get-briefing call + its result, then half-formed junk — when the
    // run fails (error / disconnect), so complete() never runs.
    t.messages.push(
      assistant([{ type: 'tool-call', toolName: 'get-briefing', toolCallId: 'b1', input: {} }]),
      { message: { role: 'tool', content: [{ type: 'tool-result', toolName: 'get-briefing', toolCallId: 'b1', output: { type: 'text', value: 'Military: strong.' } }] as never }, metadata: { datetime: new Date(), turn: 5 } },
      assistant([freeText('half-formed <|tool_call|> junk')]),
    );

    // Failure path: finish() without complete() trims the unwritten reply slice.
    turn.finish();

    // Only the durably-committed incoming row survives — every transient run row is gone. Since
    // getInitialMessages is a pure function of thread.messages, the next run assembles (and caches) the
    // exact same prefix it would have before this failed run: the failed content never reaches the cache.
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0].message).toEqual({ role: 'user', content: 'Your terms?' });
    expect(JSON.stringify(t.messages)).not.toContain('get-briefing');
    expect(JSON.stringify(t.messages)).not.toContain('junk');
    // The incoming move was durably appended once (the commit); no reply was archived.
    expect(mcp.calls('append-message')).toHaveLength(1);
  });
});
