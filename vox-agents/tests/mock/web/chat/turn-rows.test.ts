/**
 * @module tests/mock/web/turn-rows
 *
 * Coverage for the transport-neutral row contract `runChatTurn` reports (stage 7.04 work item 2):
 * `connected.rows` (the durable caller row committed before the model ran), `done.rows` /
 * `error.rows` (everything committed after), the phase boundary between them, the single-terminal-
 * event guarantee, and the cache repair driven from those same rows instead of a transcript reread.
 *
 * The mid-run writes are made by calling the REAL write-through helpers from the fake agent run —
 * the same functions the diplomat's negotiator and close tools call — so what is asserted is the
 * production reporting path, not a stand-in for it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockMcpClient, structuredResult } from '../../../helpers/mock-mcp-client.js';
import { transcriptRow } from '../../../helpers/diplomacy-fixtures.js';
import type { TranscriptMessage } from '../../../../src/utils/diplomacy/transcript/transcript-utils.js';

vi.mock('../../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { agentRegistry } from '../../../../src/infra/agent-registry.js';
import { contextRegistry } from '../../../../src/infra/context-registry.js';
import type {
  ChatConnectedEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatStreamSink,
  EnvoyThread,
} from '../../../../src/types/index.js';
import {
  appendDealProposal,
  appendDealReject,
  closeConversation,
  enactAgentDeal,
} from '../../../../src/utils/diplomacy/deal/deal.js';
import { reportThreadRow, stageThreadClose } from '../../../../src/utils/diplomacy/turn/active-turn-state.js';
import { appendTranscriptMessageRow } from '../../../../src/utils/diplomacy/transcript/transcript.js';
import { sendMessageToolName } from '../../../../src/utils/diplomacy/constants.js';
import { chatThreadStore } from '../../../../src/web/chat/store.js';
import { runChatTurn } from '../../../../src/web/chat/turn.js';
import { createSendMessageTool } from '../../../../src/envoy/tools/send-message-tool.js';

let mcp: ReturnType<typeof installMockMcpClient>;
let threadSeq = 0;

/** Every terminal/connect event a turn emitted, in order, for the single-event assertions. */
interface RecordingSink extends ChatStreamSink {
  connectedEvents: ChatConnectedEvent[];
  doneEvents: ChatDoneEvent[];
  errorEvents: ChatErrorEvent[];
  terminalCount(): number;
}

/** A sink that records every event instead of writing a wire format. */
function recordingSink(): RecordingSink {
  const connectedEvents: ChatConnectedEvent[] = [];
  const doneEvents: ChatDoneEvent[] = [];
  const errorEvents: ChatErrorEvent[] = [];
  return {
    connectedEvents,
    doneEvents,
    errorEvents,
    terminalCount: () => doneEvents.length + errorEvents.length,
    connected: (data) => { connectedEvents.push(data); },
    message: () => {},
    error: (data) => { errorEvents.push(data); },
    done: (data) => { doneEvents.push(data); },
    onDisconnect: () => {},
  };
}

/**
 * A VoxContext stand-in exposing only what the turn runner touches: the live session turn, the run
 * scope, and `execute` (which stands in for the diplomat's whole run, including its durable writes).
 */
function mockContext(execute: (name: string, input: EnvoyThread) => Promise<unknown>) {
  const base = { turn: 5, gameID: 'g', playerID: 3, gameStates: { 5: { options: {}, players: {} } } };
  return {
    id: 'g-player-3',
    session: { getTurn: () => 5 },
    getBaseParameters: () => base,
    execute: vi.fn(execute),
    async withRun(_options: unknown, callback: (run: unknown) => Promise<unknown>) {
      return callback({ id: 'run-0', parameters: base, abort: vi.fn() });
    },
  } as never;
}

/** Register a fresh live diplomacy thread (ordered pair 1↔3, agent voices seat 3). */
function registerThread(): EnvoyThread {
  threadSeq += 1;
  const thread: EnvoyThread = {
    id: `dipl:g:1:3#rows-${threadSeq}`,
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
    metadata: { createdAt: new Date(), updatedAt: new Date() },
  };
  chatThreadStore.set(thread);
  return thread;
}

/**
 * Make `append-message` echo the canonical committed row the real store returns. `failOn` makes the
 * store refuse that one message type, so a test can fail a single append mid-turn.
 */
function echoAppends(startID: number, failOn?: string): void {
  let nextID = startID;
  mcp.onTool('append-message', (args) => {
    if (args.MessageType === failOn) throw new Error(`store refused the ${failOn}`);
    return structuredResult(transcriptRow({
      ID: nextID++,
      SpeakerID: args.SpeakerID as number,
      MessageType: args.MessageType as TranscriptMessage['MessageType'],
      Content: args.Content as string,
      Payload: (args.Payload ?? {}) as Record<string, any>,
      Turn: 5,
    }));
  });
}

/** Archive a spoken tool result, then leave the raw model output for terminal cleanup. */
async function speak(thread: EnvoyThread, text: string): Promise<void> {
  const row = await appendTranscriptMessageRow(thread, thread.agent, text);
  thread.messages.push({
    message: {
      role: 'assistant',
      content: [{
        type: 'tool-call', toolCallId: `send-${row.ID}`, toolName: sendMessageToolName, input: { Message: text },
      }] as never,
    },
    metadata: { datetime: new Date(), turn: 5 },
  });
}

/** A durable outcome row projection as the transactional deal actions return one. */
const outcomeRow = (ID: number, MessageType: TranscriptMessage['MessageType']) => transcriptRow({
  ID, SpeakerID: 3, MessageType, Payload: { ProposalMessageID: 7 }, Turn: 5,
});

beforeEach(() => {
  mcp = installMockMcpClient();
  vi.restoreAllMocks();
  // `speaksOnlyViaSendMessage` is the archival contract the diplomacy gate admits a voice on; a stub without
  // it describes a voice the chat factory would have refused.
  vi.spyOn(agentRegistry, 'get').mockReturnValue({ name: 'diplomat', description: 'Diplomat', tags: [], speaksOnlyViaSendMessage: true } as never);
  mcp.respondWith('read-transcript', structuredResult({ messages: [] }));
  mcp.respondWith('inspect-deal', structuredResult({ items: [], promises: [], tradableRange: {} }));
  echoAppends(100);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runChatTurn row contract', () => {
  it('reports the committed caller text row on connected and the archived reply on done', async () => {
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      await speak(input, 'A measured reply.');
      return input;
    }));
    const sink = recordingSink();

    await expect(runChatTurn({ kind: 'text', chatId: thread.id, message: 'Will you trade?' }, sink))
      .resolves.toBeUndefined();

    expect(sink.connectedEvents[0]!.rows).toEqual([
      expect.objectContaining({ ID: 100, MessageType: 'text', Content: 'Will you trade?' }),
    ]);
    expect(sink.doneEvents[0]!.rows).toEqual([
      expect.objectContaining({ ID: 101, MessageType: 'text', Content: 'A measured reply.' }),
    ]);
    // The cache mirrors the exact durable rows, ids and all — the same shape a reload would hydrate.
    expect(thread.messages.map((m) => m.metadata.id)).toEqual([100, 101]);
  });

  it('attaches the retained trace to the echo-cleaned durable reply row', async () => {
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      const tool = createSendMessageTool({
        id: 'send-test',
        currentInput: input,
        currentParameters: { turn: 5, playerID: input.agent },
      } as never) as any;
      await tool.execute(
        { Message: '[Turn 5] Player 3: Agreed.' },
        { toolCallId: 'send-clean', messages: [] },
      );
      // Envoy.stopCheck reuses the same cleaner before retaining the native response trajectory.
      input.messages.push({
        message: {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'A concise acceptance is appropriate.' },
            {
              type: 'tool-call',
              toolCallId: 'send-clean',
              toolName: sendMessageToolName,
              input: { Message: 'Agreed.' },
            },
          ],
        },
        metadata: { datetime: new Date(), turn: 5 },
      });
      return input;
    }));
    const sink = recordingSink();

    await runChatTurn({ kind: 'text', chatId: thread.id, message: 'Do we agree?' }, sink);

    expect(sink.doneEvents[0]!.rows).toEqual([
      expect.objectContaining({ ID: 101, Content: 'Agreed.' }),
    ]);
    const cachedReply = thread.messages.find((item) => item.metadata.id === 101)!;
    expect(cachedReply.message).toEqual({ role: 'assistant', content: 'Agreed.' });
    expect(cachedReply.metadata.trace).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'A concise acceptance is appropriate.' }],
      },
    ]);
  });

  it('reports the committed proposal row on connected, with `deal` as its compatibility view', async () => {
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      await speak(input, 'We will weigh your offer.');
      return input;
    }));
    const sink = recordingSink();

    await runChatTurn({
      kind: 'deal',
      chatId: thread.id,
      deal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', amount: 50 }], promises: [] },
    }, sink);

    const connected = sink.connectedEvents[0]!;
    expect(connected.rows.map((row) => row.ID)).toEqual([100]);
    expect(connected.rows[0]!.MessageType).toBe('deal-proposal');
    // `deal` is derived from the very same committed row the internal contract carries.
    expect(connected.deal).toBe(connected.rows[0]);
  });

  it('reports a counter caller row when the submission answers the open offer', async () => {
    const open = transcriptRow({
      ID: 7, SpeakerID: 3, MessageType: 'deal-proposal', Content: 'Offer',
      Payload: { Deal: { version: 1, items: [], promises: [] } }, Turn: 5,
    });
    mcp.respondWith('read-transcript', structuredResult({ messages: [open] }));
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      await speak(input, 'Noted.');
      return input;
    }));
    const sink = recordingSink();

    await runChatTurn({
      kind: 'deal',
      chatId: thread.id,
      deal: { version: 1, items: [], promises: [] },
      expectedProposalID: 7,
    }, sink);

    expect(sink.connectedEvents[0]!.rows[0]!.MessageType).toBe('deal-counter');
  });

  it('has no durable caller row for a {{{Greeting}}} trigger', async () => {
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      await speak(input, 'Greetings, neighbor.');
      return input;
    }));
    const sink = recordingSink();

    await runChatTurn({ kind: 'text', chatId: thread.id, message: '{{{Greeting}}}' }, sink);

    // The trigger is an agent trigger, not an utterance: nothing was archived to report.
    expect(sink.connectedEvents[0]!.rows).toEqual([]);
    expect(sink.doneEvents[0]!.rows.map((row) => row.ID)).toEqual([100]);
  });

  it('captures every mid-run durable row in transcript-ID order, whatever order it was written in', async () => {
    // The negotiator's tools and the close tool all write during the run. Each reports the exact row
    // the store confirmed; the turn returns them sorted by durable ID, which is the append order.
    mcp.respondWith('enact-agent-deal', structuredResult({
      ProposalMessageID: 7, AcceptMessageID: 300, EnactedMessageID: 301,
      AlreadyEnacted: false, Enacted: true, Turn: 5,
      AcceptRow: outcomeRow(300, 'deal-accept'),
      EnactedRow: outcomeRow(301, 'deal-enacted'),
    }));
    mcp.respondWith('reject-agent-deal', structuredResult({
      Result: 'rejected', ProposalMessageID: 7, AlreadyRejected: false,
      Row: outcomeRow(200, 'deal-reject'),
    }));
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      // Deliberately reported newest-first so the ordering is proven, not coincidental.
      await enactAgentDeal(7, { accepterID: 1, thread: input });
      await appendDealReject(input, 3, 'Declined.', 7);
      await appendDealProposal(input, 3, 'deal-counter', { version: 1, items: [], promises: [] });
      await speak(input, 'Here is where we stand.');
      return input;
    }));
    const sink = recordingSink();

    await runChatTurn({ kind: 'text', chatId: thread.id, message: 'Well?' }, sink);

    // 100 = the caller row (connected phase). 101 = the mid-run counter, 102 = the archived reply.
    expect(sink.doneEvents[0]!.rows.map((row) => row.ID)).toEqual([101, 102, 200, 300, 301]);
    // `deals` is the Web compatibility view over the same set — the reply text row is not a deal row.
    expect(sink.doneEvents[0]!.deals.map((row) => row.ID)).toEqual([101, 200, 300, 301]);
    // The turn never rereads the transcript to learn what it wrote.
    expect(mcp.calls('read-transcript')).toHaveLength(0);
    // Terminal reconciliation inserts the entire captured set in durable order at the reply boundary.
    expect(thread.messages.map((m) => m.metadata.id)).toEqual([100, 101, 102, 200, 300, 301]);
  });

  it('captures the ordered rejection and close rows a mid-run close writes', async () => {
    const open = transcriptRow({
      ID: 7, MessageType: 'deal-proposal', Content: 'Offer',
      Payload: { Deal: { version: 1, items: [], promises: [] } }, Turn: 5,
    });
    mcp.respondWith('read-transcript', structuredResult({ messages: [open] }));
    mcp.respondWith('reject-agent-deal', structuredResult({
      Result: 'rejected', ProposalMessageID: 7, AlreadyRejected: false,
      Row: outcomeRow(101, 'deal-reject'),
    }));
    // The caller row commits first (100), then the retraction (101, written by the reject action),
    // then the close (102) — so the ids follow the real append order across the two writers.
    const appendIDs = [100, 102];
    mcp.onTool('append-message', (args) => structuredResult(transcriptRow({
      ID: appendIDs.shift(),
      SpeakerID: args.SpeakerID as number, MessageType: args.MessageType as TranscriptMessage['MessageType'],
      Content: args.Content as string, Turn: 5,
    })));
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      await closeConversation(input, input.agent, 'Until next time.');
      // The close-conversation tool call the diplomat made: a deliberate terminal action, so the turn
      // archives no "lost my train of thought" stand-in reply.
      input.messages.push({
        message: { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'close-conversation', input: {} }] as never },
        metadata: { datetime: new Date(), turn: 5 },
      });
      return input;
    }));
    const sink = recordingSink();

    await runChatTurn({ kind: 'text', chatId: thread.id, message: 'Anything else?' }, sink);

    // Both rows the close created reach the client, in durable order.
    expect(sink.doneEvents[0]!.rows.map((row) => [row.ID, row.MessageType]))
      .toEqual([[101, 'deal-reject'], [102, 'close']]);
    expect(thread.messages.map((m) => m.metadata.id)).toEqual([100, 101, 102]);
  });

  it('commits a staged close after the spoken message and negotiated outcome', async () => {
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      await speak(input, 'I will make our position clear.');
      await appendDealProposal(input, input.agent, 'deal-proposal', { version: 1, items: [], promises: [] });
      expect(stageThreadClose(input, { speakerID: input.agent, content: 'Until next time.' })).toBe(true);
      input.messages.push({
        message: {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 'close-1', toolName: 'close-conversation', input: {} }],
        },
        metadata: { datetime: new Date(), turn: 5 },
      });
      return input;
    }));
    const sink = recordingSink();

    await runChatTurn({ kind: 'text', chatId: thread.id, message: 'What do you propose?' }, sink);

    expect(sink.doneEvents[0]!.rows.map((row) => [row.MessageType, row.Content]))
      .toEqual([
        ['text', 'I will make our position clear.'],
        ['deal-proposal', 'A deal was proposed.'],
        ['close', 'Until next time.'],
      ]);
  });

  it('completes a committed reply when the staged close write fails', async () => {
    echoAppends(100, 'close');
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      await speak(input, 'My reply was delivered.');
      expect(stageThreadClose(input, {
        speakerID: input.agent,
        content: 'Until next time.',
      })).toBe(true);
      input.messages.push({
        message: {
          role: 'assistant',
          content: [{
            type: 'tool-call',
            toolCallId: 'close-1',
            toolName: 'close-conversation',
            input: {},
          }],
        },
        metadata: { datetime: new Date(), turn: 5 },
      });
      return input;
    }));
    const sink = recordingSink();

    await runChatTurn({ kind: 'text', chatId: thread.id, message: 'Your answer?' }, sink);

    expect(sink.errorEvents).toHaveLength(0);
    expect(sink.doneEvents).toHaveLength(1);
    expect(sink.doneEvents[0]!.rows).toEqual([
      expect.objectContaining({
        ID: 101,
        MessageType: 'text',
        Content: 'My reply was delivered.',
      }),
    ]);
    expect(thread.messages.map((item) => item.metadata.id)).toEqual([100, 101]);
    expect(thread.closeTurn).toBeUndefined();
  });

  it('suppresses duplicate reports and rows belonging to another thread', async () => {
    const other = registerThread();
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      const row = outcomeRow(200, 'deal-reject');
      reportThreadRow(input, row);
      reportThreadRow(input, { ...row, Content: 'a second report of the same row' });
      reportThreadRow(other, outcomeRow(201, 'deal-reject'));
      await speak(input, 'Understood.');
      return input;
    }));
    const sink = recordingSink();

    await runChatTurn({ kind: 'text', chatId: thread.id, message: 'Well?' }, sink);

    expect(sink.doneEvents[0]!.rows.map((row) => row.ID)).toEqual([101, 200]);
    expect(sink.doneEvents[0]!.rows.find((row) => row.ID === 200)!.Content).toBe('');
  });

  it('never lets a transcript ID appear in both connected.rows and the terminal rows', async () => {
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      // A misbehaving writer re-reports the caller row; the phase boundary must reject it.
      reportThreadRow(input, { ID: 100, SpeakerID: 1, MessageType: 'text', Content: 'Well?', Turn: 5 });
      await speak(input, 'Understood.');
      return input;
    }));
    const sink = recordingSink();

    await runChatTurn({ kind: 'text', chatId: thread.id, message: 'Well?' }, sink);

    const connectedIDs = sink.connectedEvents[0]!.rows.map((row) => row.ID);
    const terminalIDs = sink.doneEvents[0]!.rows.map((row) => row.ID);
    expect(connectedIDs).toEqual([100]);
    expect(terminalIDs).not.toContain(100);
    expect(terminalIDs.filter((id) => connectedIDs.includes(id))).toEqual([]);
  });

  it('drops rows reported after the terminal snapshot, so detached work cannot extend it', async () => {
    const thread = registerThread();
    let detached: (() => void) | undefined;
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      detached = () => reportThreadRow(input, outcomeRow(500, 'deal-reject'));
      await speak(input, 'Understood.');
      return input;
    }));
    const sink = recordingSink();

    await runChatTurn({ kind: 'text', chatId: thread.id, message: 'Well?' }, sink);
    detached!();

    expect(sink.doneEvents[0]!.rows.map((row) => row.ID)).toEqual([101]);
  });

  it('reports rows committed before a post-commit failure on error, and keeps them in the cache', async () => {
    mcp.respondWith('reject-agent-deal', structuredResult({
      Result: 'rejected', ProposalMessageID: 7, AlreadyRejected: false,
      Row: outcomeRow(200, 'deal-reject'),
    }));
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      await appendDealReject(input, 3, 'Declined.', 7);
      // Transient model output that must NOT survive the failure.
      input.messages.push({
        message: { role: 'assistant', content: 'half-formed draft' },
        metadata: { datetime: new Date(), turn: 5 },
      });
      throw new Error('LLM exploded');
    }));
    const sink = recordingSink();

    await runChatTurn({ kind: 'text', chatId: thread.id, message: 'Well?' }, sink);

    expect(sink.doneEvents).toHaveLength(0);
    expect(sink.errorEvents).toHaveLength(1);
    expect(sink.errorEvents[0]!.message).toContain('LLM exploded');
    expect(sink.errorEvents[0]!.rows.map((row) => row.ID)).toEqual([200]);
    // An append-only store cannot unwrite the rejection: the caller row and the rejection survive the
    // failed-turn cleanup, and only the streamed draft is rolled back.
    expect(thread.messages.map((m) => m.metadata.id)).toEqual([100, 200]);
    expect(JSON.stringify(thread.messages)).not.toContain('half-formed draft');
  });

  it('keeps an archived send-message row when later agent work fails', async () => {
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      await speak(input, 'This was already delivered.');
      input.messages.push({
        message: { role: 'assistant', content: 'transient reasoning after delivery' },
        metadata: { datetime: new Date(), turn: 5 },
      });
      throw new Error('later work failed');
    }));
    const sink = recordingSink();

    await runChatTurn({ kind: 'text', chatId: thread.id, message: 'Your answer?' }, sink);

    expect(sink.doneEvents).toHaveLength(0);
    expect(sink.errorEvents).toHaveLength(1);
    expect(sink.errorEvents[0]!.rows).toEqual([
      expect.objectContaining({ ID: 101, Content: 'This was already delivered.' }),
    ]);
    expect(thread.messages.map((item) => [item.metadata.id, item.message.content])).toEqual([
      [100, 'Your answer?'],
      [101, 'This was already delivered.'],
    ]);
    expect(JSON.stringify(thread.messages)).not.toContain(sendMessageToolName);
    expect(JSON.stringify(thread.messages)).not.toContain('transient reasoning after delivery');
  });

  it('fails the turn when the final reply cannot be archived, instead of a false completion', async () => {
    // Swallowing this append let a streamed draft masquerade as a durable completed reply.
    let appended = 0;
    mcp.onTool('append-message', (args) => {
      appended += 1;
      if (appended > 1) throw new Error('store refused the reply');
      return structuredResult(transcriptRow({
        ID: 100,
        SpeakerID: args.SpeakerID as number, MessageType: args.MessageType as TranscriptMessage['MessageType'],
        Content: args.Content as string, Turn: 5,
      }));
    });
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      await speak(input, 'A reply that never lands.');
      return input;
    }));
    const sink = recordingSink();

    await runChatTurn({ kind: 'text', chatId: thread.id, message: 'Well?' }, sink);

    expect(sink.doneEvents).toHaveLength(0);
    expect(sink.errorEvents).toHaveLength(1);
    expect(sink.errorEvents[0]!.message).toContain('store refused the reply');
    expect(sink.errorEvents[0]!.rows).toEqual([]);
    // Only the committed caller row remains; the undurable draft is gone from the cache too.
    expect(thread.messages.map((m) => m.metadata.id)).toEqual([100]);
  });

  it.each([
    ['a completed run', async (input: EnvoyThread) => { await speak(input, 'Done.'); return input; }],
    ['a failed run', async () => { throw new Error('LLM exploded'); }],
  ])('emits exactly one terminal event for %s', async (_label, execute) => {
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => execute(input)));
    const sink = recordingSink();

    await runChatTurn({ kind: 'text', chatId: thread.id, message: 'Well?' }, sink);

    expect(sink.connectedEvents).toHaveLength(1);
    expect(sink.terminalCount()).toBe(1);
  });

  it('emits a single error when the terminal event itself throws, never a second event', async () => {
    const thread = registerThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(mockContext(async (_n, input) => {
      await speak(input, 'Done.');
      return input;
    }));
    const sink = recordingSink();
    const done = vi.fn(() => { throw new Error('socket closed'); });
    sink.done = done;

    await runChatTurn({ kind: 'text', chatId: thread.id, message: 'Well?' }, sink);

    // `done` was attempted once and claimed the turn's terminal slot, so the outer catch must not
    // then send an `error` for the very same turn.
    expect(done).toHaveBeenCalledTimes(1);
    expect(sink.errorEvents).toHaveLength(0);
  });
});
