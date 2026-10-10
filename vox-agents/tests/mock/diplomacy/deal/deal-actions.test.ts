/**
 * @module tests/mock/diplomacy/deal-actions
 *
 * Coverage for the transport-neutral deal actions (src/utils/diplomacy/deal-actions.ts) and the shared
 * live-turn guard they run (src/utils/diplomacy/live-turn.ts). These are the paths BOTH the Express
 * routes and the in-game bridge take, so everything asserted here is the behaviour both clients get:
 * the typed failures, the exact durable rows, `changed`, and the live-cache hydration — with no
 * transcript reread and no catch-time re-probe.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockMcpClient, structuredResult } from '../../../helpers/mock-mcp-client.js';
import { transcriptRow } from '../../../helpers/diplomacy-fixtures.js';
import type { EnvoyThread } from '../../../../src/types/index.js';
import type { TranscriptMessage } from '../../../../src/utils/diplomacy/transcript/transcript-utils.js';

vi.mock('../../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { contextRegistry } from '../../../../src/infra/context-registry.js';
import {
  NotDiplomacyThreadError,
  acceptDealAction,
  rejectDealAction,
} from '../../../../src/utils/diplomacy/deal/deal-actions.js';
import {
  ConversationClosedThisTurnError,
  LiveTurnUnavailableError,
} from '../../../../src/utils/diplomacy/turn/live-turn.js';
import { ProposalConflictError } from '../../../../src/utils/diplomacy/deal/deal.js';
import { ThreadBusyError, withThreadLock } from '../../../../src/utils/diplomacy/turn/chat-turn-commit.js';

let mcp: ReturnType<typeof installMockMcpClient>;
let threadSeq = 0;

beforeEach(() => {
  mcp = installMockMcpClient();
  vi.restoreAllMocks();
  threadSeq += 1;
  // The shared guard resolves the live turn through the context registry; a session-bearing context
  // is the live case both clients run in.
  mockLiveTurn(5);
});

/** Point the context registry at a live context reporting `turn` (or none, when undefined). */
function mockLiveTurn(turn: number | undefined): void {
  vi.spyOn(contextRegistry, 'get').mockReturnValue({
    session: { getTurn: () => turn },
    getBaseParameters: () => ({ turn: 99 }),
  } as never);
}

/** A live diplomacy thread: ordered pair 1↔3, agent voices seat 3, audience (the human) is seat 1. */
function thread(partial: Partial<EnvoyThread> = {}): EnvoyThread {
  return {
    // A distinct id per test keeps the module-level thread lock from leaking between cases.
    id: `dipl:g:1:3#${threadSeq}`,
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
    metadata: { createdAt: new Date(), updatedAt: new Date(0) },
    ...partial,
  };
}

/** A stored open proposal, authored by `speaker`, as `read-transcript` returns it. */
const storedProposal = (speaker: number) => transcriptRow({
  ID: 7, SpeakerID: speaker, MessageType: 'deal-proposal', Content: 'Offer',
  Payload: { Deal: { version: 1, items: [], promises: [] } }, Turn: 5,
});

/** A durable outcome row projection as the transactional actions return one. */
const outcomeRow = (ID: number, MessageType: TranscriptMessage['MessageType'], SpeakerID = 1) => transcriptRow({
  ID, MessageType, SpeakerID, Payload: { ProposalMessageID: 7 }, Turn: 5,
});

describe('acceptDealAction', () => {
  beforeEach(() => {
    mcp.respondWith('read-transcript', structuredResult({ messages: [storedProposal(3)] }));
  });

  it('enacts as the audience endpoint and returns the exact committed rows', async () => {
    mcp.respondWith('enact-agent-deal', structuredResult({
      ProposalMessageID: 7, AcceptMessageID: 8, EnactedMessageID: 9,
      AlreadyEnacted: false, Enacted: true, Turn: 5,
      AcceptRow: outcomeRow(8, 'deal-accept'),
      EnactedRow: outcomeRow(9, 'deal-enacted'),
    }));
    const t = thread();

    const result = await acceptDealAction(t, 7);

    expect(mcp.calls('enact-agent-deal')[0]!.args).toMatchObject({ ProposalMessageID: 7, AccepterID: 1 });
    expect(result.changed).toBe(true);
    expect(result.rows).toEqual([outcomeRow(8, 'deal-accept'), outcomeRow(9, 'deal-enacted')]);
    // Hydrated straight into the live cache from the returned rows — no transcript reread.
    expect(t.messages.map((m) => m.metadata.id)).toEqual([8, 9]);
    expect(t.messages[0]!.deal?.MessageType).toBe('deal-accept');
  });

  it('reads the transcript exactly once: the precheck, with no catch-time re-probe', async () => {
    // The old accept route re-read the proposal from its catch block to decide 409-vs-502. Both
    // backend transactions now report a lost race as a typed conflict, so that race-prone second read
    // (which could report an already-stale verdict) is gone.
    mcp.respondWith('enact-agent-deal', structuredResult({
      ProposalMessageID: 7, Conflict: { Reason: 'superseded', Message: 'Proposal message 7 is not the current active proposal' },
    }));

    const err = await acceptDealAction(thread(), 7).catch((e) => e);

    expect(err).toBeInstanceOf(ProposalConflictError);
    expect(mcp.calls('read-transcript')).toHaveLength(1);
  });

  it('keeps a proposal-state race after the precheck a typed conflict, never an infrastructure failure', async () => {
    // The proposal was open when the precheck read it and gone by the time the enactment ran.
    mcp.respondWith('enact-agent-deal', structuredResult({
      ProposalMessageID: 7, Conflict: { Reason: 'answered', Message: 'Proposal message 7 is not open; it was answered by deal-reject' },
    }));

    await expect(acceptDealAction(thread(), 7)).rejects.toBeInstanceOf(ProposalConflictError);
  });

  it('propagates a genuine enactment failure as an ordinary error, not a conflict', async () => {
    mcp.failWith('enact-agent-deal', 'the game bridge is unavailable');

    const err = await acceptDealAction(thread(), 7).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ProposalConflictError);
  });

  it('refuses a self-authored proposal before touching the enactment route', async () => {
    // Seat 1 (the audience) authored the offer, so accepting it would be accepting your own offer.
    mcp.respondWith('read-transcript', structuredResult({ messages: [storedProposal(1)] }));

    const err = await acceptDealAction(thread(), 7).catch((e) => e);

    expect(err).toBeInstanceOf(ProposalConflictError);
    expect(err.message).toMatch(/cannot respond to its own proposal/i);
    expect(mcp.calls('enact-agent-deal')).toHaveLength(0);
  });

  it('reports an already-enacted deal as unchanged while still returning its durable row', async () => {
    mcp.respondWith('enact-agent-deal', structuredResult({
      ProposalMessageID: 7, EnactedMessageID: 9, AlreadyEnacted: true, Enacted: false, Turn: 5,
      EnactedRow: outcomeRow(9, 'deal-enacted'),
    }));
    const t = thread();

    const result = await acceptDealAction(t, 7);

    expect(result.changed).toBe(false);
    expect(result.rows).toEqual([outcomeRow(9, 'deal-enacted')]);
    // The acknowledgement still repairs a cache that never saw the original enactment.
    expect(t.messages.map((m) => m.metadata.id)).toEqual([9]);
  });

  it('does not duplicate a row the cache already holds', async () => {
    mcp.respondWith('enact-agent-deal', structuredResult({
      ProposalMessageID: 7, EnactedMessageID: 9, AlreadyEnacted: true, Enacted: false, Turn: 5,
      EnactedRow: outcomeRow(9, 'deal-enacted'),
    }));
    const t = thread();

    await acceptDealAction(t, 7);
    await acceptDealAction(t, 7);

    expect(t.messages.map((m) => m.metadata.id)).toEqual([9]);
  });
});

describe('rejectDealAction', () => {
  /** Program the transactional action with one outcome. */
  const rejectResult = (over: Record<string, unknown>) => structuredResult({
    ProposalMessageID: 7, AlreadyRejected: false, ...over,
  });

  it('rejects through the transactional action and hydrates the returned row', async () => {
    mcp.respondWith('reject-agent-deal', rejectResult({
      Result: 'rejected', Row: outcomeRow(11, 'deal-reject'),
    }));
    const t = thread();

    const result = await rejectDealAction(t, 7, '  Not this time.  ');

    expect(mcp.calls('reject-agent-deal')[0]!.args).toEqual({
      PlayerAID: 1, PlayerBID: 3, ProposalMessageID: 7, SpeakerID: 1, Content: 'Not this time.',
    });
    expect(result).toEqual({ rows: [outcomeRow(11, 'deal-reject')], changed: true });
    expect(t.messages.map((m) => m.metadata.id)).toEqual([11]);
    // Proposal state is the backend's business: no precheck read, and no post-action read either.
    expect(mcp.calls('read-transcript')).toHaveLength(0);
  });

  it('falls back to the default outward line when none is supplied', async () => {
    mcp.respondWith('reject-agent-deal', rejectResult({
      Result: 'rejected', Row: outcomeRow(11, 'deal-reject'),
    }));

    await rejectDealAction(thread(), 7);

    expect(mcp.calls('reject-agent-deal')[0]!.args.Content).toBe('The deal was rejected.');
  });

  it('returns the existing row without a redundant write when repeated', async () => {
    const t = thread();
    mcp.respondWith('reject-agent-deal', rejectResult({
      Result: 'rejected', Row: outcomeRow(11, 'deal-reject'),
    }));
    const first = await rejectDealAction(t, 7);

    mcp.respondWith('reject-agent-deal', rejectResult({
      Result: 'already-rejected', AlreadyRejected: true, Row: outcomeRow(11, 'deal-reject'),
    }));
    const second = await rejectDealAction(t, 7);

    expect(first.changed).toBe(true);
    // The row still comes back so a pending client action resolves, but nothing changed…
    expect(second.changed).toBe(false);
    expect(second.rows).toEqual(first.rows);
    // …and the cache holds one rejection, not two.
    expect(t.messages.map((m) => m.metadata.id)).toEqual([11]);
  });

  it('permits the proposal author to retract their own offer', async () => {
    // Either endpoint may speak deal-reject; the transactional action decides, and there is no
    // self-authorship precheck standing in its way (unlike accept).
    mcp.respondWith('reject-agent-deal', rejectResult({
      Result: 'rejected', Row: outcomeRow(11, 'deal-reject'),
    }));

    await expect(rejectDealAction(thread(), 7)).resolves.toMatchObject({ changed: true });
  });

  it('translates a structured conflict into ProposalConflictError', async () => {
    mcp.respondWith('reject-agent-deal', rejectResult({
      Result: 'conflict',
      ConflictReason: 'rejected-by-other',
      ConflictMessage: 'Proposal message 7 was already rejected by endpoint 3',
    }));

    await expect(rejectDealAction(thread(), 7)).rejects.toBeInstanceOf(ProposalConflictError);
  });
});

describe('the shared live-turn and closed-this-turn guard', () => {
  /** Both actions must run the identical guard, so every case is asserted against both. */
  const actions: [string, (t: EnvoyThread) => Promise<unknown>][] = [
    ['acceptDealAction', (t) => acceptDealAction(t, 7)],
    ['rejectDealAction', (t) => rejectDealAction(t, 7)],
  ];

  it.each(actions)('%s refuses a conversation that is not a diplomacy thread', async (_name, act) => {
    await expect(act(thread({ diplomacy: false }))).rejects.toBeInstanceOf(NotDiplomacyThreadError);
    expect(mcp.callLog).toHaveLength(0);
  });

  it.each(actions)('%s refuses a live thread whose game turn is unavailable', async (_name, act) => {
    // The removed bug: the old routes fell back to `thread.metadata.turn` (or turn zero), which turned
    // "the game is not running" into "turn 0, definitely not closed" — and let a conversation closed on
    // this turn accept deal actions. Neither fallback may apply now.
    mockLiveTurn(undefined);
    const t = thread({ closeTurn: 9, metadata: { createdAt: new Date(), updatedAt: new Date(), turn: 9 } });

    await expect(act(t)).rejects.toBeInstanceOf(LiveTurnUnavailableError);
    expect(mcp.callLog).toHaveLength(0);
  });

  it.each(actions)('%s refuses a conversation closed on the current turn', async (_name, act) => {
    await expect(act(thread({ closeTurn: 5 }))).rejects.toBeInstanceOf(ConversationClosedThisTurnError);
    expect(mcp.callLog).toHaveLength(0);
  });

  it.each(actions)('%s allows a conversation closed on an earlier turn', async (_name, act) => {
    mcp.respondWith('read-transcript', structuredResult({ messages: [storedProposal(3)] }));
    mcp.respondWith('enact-agent-deal', structuredResult({
      ProposalMessageID: 7, AcceptMessageID: 8, EnactedMessageID: 9,
      AlreadyEnacted: false, Enacted: true, Turn: 5,
      AcceptRow: outcomeRow(8, 'deal-accept'), EnactedRow: outcomeRow(9, 'deal-enacted'),
    }));
    mcp.respondWith('reject-agent-deal', structuredResult({
      Result: 'rejected', ProposalMessageID: 7, AlreadyRejected: false, Row: outcomeRow(11, 'deal-reject'),
    }));

    await expect(act(thread({ closeTurn: 4 }))).resolves.toBeDefined();
  });

  it.each(actions)('%s refuses to interleave with a turn holding the thread lock', async (_name, act) => {
    const t = thread();
    let release!: () => void;
    const held = withThreadLock(t, () => new Promise<void>((resolve) => { release = resolve; }));

    await expect(act(t)).rejects.toBeInstanceOf(ThreadBusyError);

    release();
    await held;
  });
});
