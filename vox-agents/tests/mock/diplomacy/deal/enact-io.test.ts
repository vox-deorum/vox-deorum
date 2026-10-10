/**
 * Tests for the stage-5 enactment-route wrapper and active-proposal reader in
 * src/utils/diplomacy/deal.ts (enactAgentDeal / readActiveProposal). Uses the shared
 * mcpClient fixture — no live MCP server / game.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockMcpClient, structuredResult } from '../../../helpers/mock-mcp-client.js';
import { transcriptRow } from '../../../helpers/diplomacy-fixtures.js';
import type { TranscriptMessage } from '../../../../src/utils/diplomacy/transcript/transcript-utils.js';

vi.mock('../../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { ProposalConflictError, enactAgentDeal, readActiveProposal } from '../../../../src/utils/diplomacy/deal/deal.js';
import { beginTurnState } from '../../../../src/utils/diplomacy/turn/active-turn-state.js';
import type { EnvoyThread } from '../../../../src/types/index.js';

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
});

/** Minimal diplomacy thread (ordered pair 1↔3, agent voices seat 3). */
function thread(): EnvoyThread {
  return {
    id: 'dipl:g:1:3',
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
}

/** A durable outcome row projection as `enact-agent-deal` returns it. */
const outcomeRow = (id: number, messageType: TranscriptMessage['MessageType']) => transcriptRow({
  ID: id, MessageType: messageType, Payload: { ProposalMessageID: 7 }, Turn: 4,
});

describe('enactAgentDeal', () => {
  it('passes the proposal id and parses the enactment record, including the committed rows', async () => {
    mcp.respondWith('enact-agent-deal', structuredResult({
      ProposalMessageID: 7,
      AcceptMessageID: 8,
      EnactedMessageID: 9,
      AlreadyEnacted: false,
      Enacted: true,
      Turn: 4,
      AcceptRow: outcomeRow(8, 'deal-accept'),
      EnactedRow: outcomeRow(9, 'deal-enacted'),
    }));

    const out = await enactAgentDeal(7);
    expect(out).toEqual({
      proposalMessageID: 7,
      acceptMessageID: 8,
      enactedMessageID: 9,
      alreadyEnacted: false,
      enacted: true,
      turn: 4,
      acceptRow: outcomeRow(8, 'deal-accept'),
      enactedRow: outcomeRow(9, 'deal-enacted'),
      rows: [outcomeRow(8, 'deal-accept'), outcomeRow(9, 'deal-enacted')],
    });
    expect(mcp.calls('enact-agent-deal')[0]!.args).toEqual({ ProposalMessageID: 7 });
  });

  it('forwards the optional accepter and content, but never the thread', async () => {
    mcp.respondWith('enact-agent-deal', structuredResult({ EnactedMessageID: 9, AlreadyEnacted: false, Enacted: false }));
    await enactAgentDeal(7, { accepterID: 3, content: 'Agreed.', thread: thread() });
    expect(mcp.calls('enact-agent-deal')[0]!.args).toEqual({ ProposalMessageID: 7, AccepterID: 3, Content: 'Agreed.' });
  });

  it('records the rows it created into the observing turn for the captured thread', async () => {
    mcp.respondWith('enact-agent-deal', structuredResult({
      ProposalMessageID: 7, AcceptMessageID: 8, EnactedMessageID: 9,
      AlreadyEnacted: false, Enacted: true, Turn: 4,
      AcceptRow: outcomeRow(8, 'deal-accept'),
      EnactedRow: outcomeRow(9, 'deal-enacted'),
    }));
    const t = thread();
    const turnState = beginTurnState(t);

    await enactAgentDeal(7, { accepterID: 1, thread: t });

    expect(turnState.freeze().map((row) => row.ID)).toEqual([8, 9]);
  });

  it('reports a prior enactment as idempotent (no accept id) and records nothing', async () => {
    // The idempotent path returns the EXISTING enacted row; it created nothing, so it contributes no
    // rows to the turn — an acknowledgement must not be announced as a fresh outcome.
    mcp.respondWith('enact-agent-deal', structuredResult({
      EnactedMessageID: 9, AlreadyEnacted: true, Enacted: false, Turn: 2,
      EnactedRow: outcomeRow(9, 'deal-enacted'),
    }));
    const t = thread();
    const turnState = beginTurnState(t);

    const out = await enactAgentDeal(7, { thread: t });

    expect(out.alreadyEnacted).toBe(true);
    expect(out.acceptMessageID).toBeUndefined();
    // The existing row still travels back so a cache that never saw it can be repaired…
    expect(out.enactedRow).toEqual(outcomeRow(9, 'deal-enacted'));
    // …but it is not part of what this call created.
    expect(out.rows).toEqual([]);
    expect(turnState.freeze()).toEqual([]);
  });

  it.each([
    ['superseded', 'Proposal message 7 is not the current active proposal'],
    ['answered', 'Proposal message 7 is not open; it was answered by deal-reject'],
    ['wrong-recipient', 'AccepterID 1 must be the proposal recipient (3)'],
  ])('translates the structured %s conflict into ProposalConflictError', async (reason, message) => {
    // A lost race over proposal state is a 409-class conflict, not the 502-class infrastructure
    // failure a thrown MCP error would be — and it is classified from the machine-readable Reason.
    mcp.respondWith('enact-agent-deal', structuredResult({
      ProposalMessageID: 7,
      Conflict: { Reason: reason, Message: message },
    }));

    const err = await enactAgentDeal(7, { accepterID: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(ProposalConflictError);
    expect(err.message).toBe(message);
  });

  it('throws when the route returns no numeric EnactedMessageID', async () => {
    mcp.respondWith('enact-agent-deal', structuredResult({ AlreadyEnacted: false }));
    await expect(enactAgentDeal(7)).rejects.toThrow('numeric EnactedMessageID');
  });
});

describe('readActiveProposal', () => {
  it('reads the transcript and reduces to the latest active proposal', async () => {
    mcp.respondWith('read-transcript', structuredResult({ messages: [
      { ID: 1, MessageType: 'text', Payload: {} },
      { ID: 2, MessageType: 'deal-proposal', Payload: { Deal: { version: 1, items: [], promises: [] } } },
      { ID: 3, MessageType: 'deal-counter', Payload: { Deal: { version: 1, items: [], promises: [] } } },
    ] }));
    const r = await readActiveProposal(1, 3);
    expect(r.active?.ID).toBe(3);
    expect(r.status).toBe('open');
    expect(r.proposals).toHaveLength(2);
  });
});
