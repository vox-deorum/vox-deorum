/**
 * Tests for the stage-7.04 reject-agent-deal tool: it writes the transcript's only `deal-reject`
 * row inside one store write transaction, is idempotent per speaker, and reports every
 * proposal-state refusal as a structured conflict rather than a thrown error. Caller bugs (wrong
 * conversation pair, a speaker outside the conversation) still throw.
 *
 * Runs against an in-memory KnowledgeStore — no bridge-service / DLL. Proposals are seeded through
 * append-message, which still owns the non-terminal message types.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import createAppendMessageTool from '../../../src/tools/actions/append-message.js';
import createEnactAgentDealTool from '../../../src/tools/actions/enact-agent-deal.js';
import createRejectAgentDealTool from '../../../src/tools/actions/reject-agent-deal.js';
import createReadTranscriptTool from '../../../src/tools/knowledge/read-transcript.js';
import { setupDiplomacyStore, seedPlayer } from '../helpers.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import * as inspectDealUtil from '../../../src/utils/lua/inspect-deal.js';
import { knowledgeManager } from '../../../src/server.js';
import { connectToolClient } from '../tool-client.js';
import { dealHelpers } from './deal-helpers.js';

// The append-message major-civ check falls back to a live Lua fetch when the cache is empty.
vi.mock('../../../src/knowledge/getters/player-information.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/knowledge/getters/player-information.js')>();
  return { ...actual, getPlayerInformations: vi.fn(async () => []) };
});

const append = createAppendMessageTool();
const enact = createEnactAgentDealTool();
const reject = createRejectAgentDealTool();
const read = createReadTranscriptTool();
let store: KnowledgeStore;
let client: Awaited<ReturnType<typeof connectToolClient>>;
const { readMessages, seedProposal } = dealHelpers(() => client, { append, read });

/** Invoke each diplomacy tool through the public MCP connection. */
async function invoke(tool: { name: string }, args: Record<string, unknown>) {
  return client.call(args, tool.name);
}

beforeEach(async () => {
  store = await setupDiplomacyStore(10);
  await seedPlayer(store, 1);
  await seedPlayer(store, 3);
  // Only the "already enacted" conflict test reaches the bridge; stub a successful enactment.
  vi.spyOn(inspectDealUtil, 'enactDeal').mockResolvedValue({ enacted: true, items: [] } as any);
  client = await connectToolClient(append, enact, reject, read);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await client.close();
  await store.close();
});

/** Base rejection args for the 1↔3 pair (endpoints deliberately passed unordered). */
function rejectArgs(proposalID: number, overrides: Record<string, unknown> = {}) {
  return { PlayerAID: 3, PlayerBID: 1, ProposalMessageID: proposalID, SpeakerID: 1, ...overrides };
}

describe('reject-agent-deal success path', () => {
  it('writes exactly one deal-reject row and returns it, with the default content', async () => {
    const proposalID = await seedProposal();

    const result = await invoke(reject, rejectArgs(proposalID) as any);

    expect(result.Result).toBe('rejected');
    expect(result.AlreadyRejected).toBe(false);
    expect(result.ConflictReason).toBeUndefined();
    expect(result.ConflictMessage).toBeUndefined();

    const rows = await readMessages(1, 3, 'deal-reject');
    expect(rows).toHaveLength(1);
    expect(result.Row).toMatchObject(rows[0]);
    expect(result.Row).toMatchObject({
      Player1ID: 1,
      Player2ID: 3,
      SpeakerID: 1,
      MessageType: 'deal-reject',
      Payload: { ProposalMessageID: proposalID },
    });
  });

  it('records a caller-supplied outward line, falling back when it is blank', async () => {
    const spoken = await invoke(reject, rejectArgs(await seedProposal(), { Content: '  Not a chance.  ' }) as any);
    expect(spoken.Row?.Content).toBe('Not a chance.');

    const blank = await invoke(reject, rejectArgs(await seedProposal(), { Content: '   ' }) as any);
    expect(blank.Row?.Content?.trim()).toBeTruthy();
  });

  it('uses the proposal\'s STORED roles, not caller-supplied ones', async () => {
    // The tool takes no role arguments at all, so a rejection can never re-label the endpoints:
    // the row inherits exactly the roles the proposal was archived with.
    const proposalID = await seedProposal();
    const result = await invoke(reject, rejectArgs(proposalID) as any);

    expect(result.Row).toMatchObject({ Player1Role: 'the leader', Player2Role: 'negotiator' });
  });

  it('accepts a rejection spoken by the proposal author (a retraction)', async () => {
    // Either endpoint may speak deal-reject: the counterparty declines, or the proposer retracts.
    // There is no separate deal-retract type.
    const proposalID = await seedProposal(3);
    const result = await invoke(reject, rejectArgs(proposalID, { SpeakerID: 3 }) as any);

    expect(result.Result).toBe('rejected');
    expect(result.Row?.SpeakerID).toBe(3);
  });

  it('orders the endpoint pair, so the caller may pass them in either order', async () => {
    const proposalID = await seedProposal();
    const result = await invoke(reject, {
      PlayerAID: 1, PlayerBID: 3, ProposalMessageID: proposalID, SpeakerID: 1,
    } as any);

    expect(result.Result).toBe('rejected');
    expect(result.Row).toMatchObject({ Player1ID: 1, Player2ID: 3 });
  });
});

describe('reject-agent-deal idempotency', () => {
  it('returns the existing row with AlreadyRejected and writes NO second row', async () => {
    const proposalID = await seedProposal();
    const first = await invoke(reject, rejectArgs(proposalID) as any);

    const second = await invoke(reject, rejectArgs(proposalID) as any);

    expect(second.Result).toBe('already-rejected');
    expect(second.AlreadyRejected).toBe(true);
    expect(second.Row).toEqual(first.Row);
    expect(second.ConflictReason).toBeUndefined();
    expect(await readMessages(1, 3, 'deal-reject')).toHaveLength(1);
  });

  it('stays idempotent even after the proposal was superseded, and still writes nothing', async () => {
    // Idempotency is checked before staleness: a retry of a rejection that already landed reports
    // the outcome it produced, not a conflict about a conversation that has since moved on.
    const proposalID = await seedProposal();
    await invoke(reject, rejectArgs(proposalID) as any);
    await seedProposal(1);

    const retry = await invoke(reject, rejectArgs(proposalID) as any);

    expect(retry.Result).toBe('already-rejected');
    expect(retry.Row?.Payload).toEqual({ ProposalMessageID: proposalID });
    expect(await readMessages(1, 3, 'deal-reject')).toHaveLength(1);
  });

  it('serializes concurrent rejections so only one writes', async () => {
    const proposalID = await seedProposal();

    const results = await Promise.all([
      invoke(reject, rejectArgs(proposalID) as any),
      invoke(reject, rejectArgs(proposalID) as any),
    ]);

    expect(results.filter((r) => r.Result === 'rejected')).toHaveLength(1);
    expect(results.filter((r) => r.Result === 'already-rejected')).toHaveLength(1);
    expect(await readMessages(1, 3, 'deal-reject')).toHaveLength(1);
  });
});

describe('reject-agent-deal conflicts', () => {
  /** Assert one structured conflict shape (no row, no write). */
  function expectConflict(result: any, reason: string) {
    expect(result.Result).toBe('conflict');
    expect(result.ConflictReason).toBe(reason);
    expect(result.AlreadyRejected).toBe(false);
    expect(result.Row).toBeUndefined();
  }

  it('refuses a rejection by the OTHER endpoint once one exists', async () => {
    const proposalID = await seedProposal();
    await invoke(reject, rejectArgs(proposalID, { SpeakerID: 1 }) as any);

    const other = await invoke(reject, rejectArgs(proposalID, { SpeakerID: 3 }) as any);

    expectConflict(other, 'rejected-by-other');
    // At most ONE terminal rejection row per proposal, whoever asks.
    expect(await readMessages(1, 3, 'deal-reject')).toHaveLength(1);
  });

  it('refuses a superseded proposal', async () => {
    const oldProposalID = await seedProposal();
    await seedProposal(1); // a counter-offer becomes the active proposal

    expectConflict(await invoke(reject, rejectArgs(oldProposalID) as any), 'superseded');
    expect(await readMessages(1, 3, 'deal-reject')).toHaveLength(0);
  });

  it('refuses a proposal that was already accepted and enacted', async () => {
    const proposalID = await seedProposal();
    await invoke(enact, { ProposalMessageID: proposalID } as any);

    expectConflict(await invoke(reject, rejectArgs(proposalID) as any), 'answered');
    expect(await readMessages(1, 3, 'deal-reject')).toHaveLength(0);
  });

  it('refuses an unknown proposal ID', async () => {
    expectConflict(await invoke(reject, rejectArgs(9999) as any), 'not-found');
  });

  it('refuses a message that is not a proposal', async () => {
    const text = await invoke(append, {
      PlayerAID: 3, PlayerBID: 1, PlayerARole: 'negotiator', PlayerBRole: 'the leader',
      SpeakerID: 3, MessageType: 'text', Content: 'Greetings.',
    } as any);

    expectConflict(await invoke(reject, rejectArgs(text.ID) as any), 'not-a-proposal');
  });
});

describe('reject-agent-deal caller bugs', () => {
  it('throws when the proposal belongs to a different conversation', async () => {
    // A wrong pair is not a race — the caller addressed the wrong conversation entirely, so it
    // must never be reported to a player as "someone beat you to it".
    await seedPlayer(store, 2);
    const proposalID = await seedProposal(); // lives in the 1↔3 pair

    await expect(
      invoke(reject, { PlayerAID: 2, PlayerBID: 3, ProposalMessageID: proposalID, SpeakerID: 3 } as any)
    ).rejects.toThrow();
    expect(await readMessages(1, 3, 'deal-reject')).toHaveLength(0);
  });

  it('throws when the speaker is not one of the two endpoints', async () => {
    const proposalID = await seedProposal();

    await expect(
      invoke(reject, rejectArgs(proposalID, { SpeakerID: 7 }) as any)
    ).rejects.toThrow();
    expect(await readMessages(1, 3, 'deal-reject')).toHaveLength(0);
  });

  it('throws when the two endpoints are identical', async () => {
    await expect(
      invoke(reject, { PlayerAID: 3, PlayerBID: 3, ProposalMessageID: 1, SpeakerID: 3 } as any)
    ).rejects.toThrow();
  });

  it('rejects the call when its expected game is no longer active', async () => {
    vi.spyOn(knowledgeManager, 'getGameId').mockReturnValue('active-game');

    await expect(
      invoke(reject, rejectArgs(1, { ExpectedGameID: 'previous-game' }) as any)
    ).rejects.toThrow();
  });
});
