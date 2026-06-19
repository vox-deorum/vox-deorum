/**
 * Tests for the stage-5 stub enact-agent-deal tool: it records deal-accept + deal-enacted
 * against a proposal (the transcript reduces to an agreed/enacted deal) WITHOUT applying any
 * in-game effect, and is idempotent on the proposal's deal-enacted record. Runs against an
 * in-memory KnowledgeStore — no bridge-service / DLL.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sql } from 'kysely';
import createAppendMessageTool from '../../../src/tools/actions/append-message.js';
import createEnactAgentDealTool from '../../../src/tools/actions/enact-agent-deal.js';
import { getDiplomaticMessages } from '../../../src/knowledge/getters/diplomatic-messages.js';
import { setupDiplomacyStore, seedPlayer } from '../helpers.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

// The append-message major-civ check falls back to a live Lua fetch when the cache is empty.
vi.mock('../../../src/knowledge/getters/player-information.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/knowledge/getters/player-information.js')>();
  return { ...actual, getPlayerInformations: vi.fn(async () => []) };
});

const append = createAppendMessageTool();
const enact = createEnactAgentDealTool();
let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupDiplomacyStore(10);
  await seedPlayer(store, 1);
  await seedPlayer(store, 3);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

/** Seed a deal proposal and return its append ID. */
async function seedProposal(
  speakerID = 3,
  deal: unknown = { version: 1, items: [], promises: [] }
): Promise<number> {
  const row = await append.execute({
    PlayerAID: 3,
    PlayerBID: 1,
    PlayerARole: 'negotiator',
    PlayerBRole: 'the leader',
    SpeakerID: speakerID,
    MessageType: 'deal-proposal',
    Content: 'Offer',
    Payload: { Deal: deal },
  } as any);
  return row.ID;
}

describe('enact-agent-deal (stub)', () => {
  it('records deal-accept + deal-enacted against the proposal, accepter defaulting to the recipient', async () => {
    const proposalID = await seedProposal();

    const result = await enact.execute({ ProposalMessageID: proposalID } as any);

    expect(result.AlreadyEnacted).toBe(false);
    expect(result.Enacted).toBe(false); // stub: no in-game effect
    expect(typeof result.AcceptMessageID).toBe('number');
    expect(typeof result.EnactedMessageID).toBe('number');

    const accepts = await getDiplomaticMessages(1, 3, { messageType: 'deal-accept' });
    const enacted = await getDiplomaticMessages(1, 3, { messageType: 'deal-enacted' });
    expect(accepts).toHaveLength(1);
    expect(enacted).toHaveLength(1);
    // The recipient (seat 1) is the accepter — the endpoint that did not author the proposal.
    expect(accepts[0].SpeakerID).toBe(1);
    expect((accepts[0].Payload as any).ProposalMessageID).toBe(proposalID);
    expect((enacted[0].Payload as any).ProposalMessageID).toBe(proposalID);
  });

  it('honors the recipient as an explicit AccepterID', async () => {
    const proposalID = await seedProposal();
    await enact.execute({ ProposalMessageID: proposalID, AccepterID: 1 } as any);
    const accepts = await getDiplomaticMessages(1, 3, { messageType: 'deal-accept' });
    expect(accepts[0].SpeakerID).toBe(1);
  });

  it('rejects self-acceptance by the proposal author', async () => {
    const proposalID = await seedProposal();
    await expect(
      enact.execute({ ProposalMessageID: proposalID, AccepterID: 3 } as any)
    ).rejects.toThrow(/must be the proposal recipient/);
  });

  it('is idempotent — a second enactment refuses and writes nothing new', async () => {
    const proposalID = await seedProposal();
    const first = await enact.execute({ ProposalMessageID: proposalID } as any);

    const second = await enact.execute({ ProposalMessageID: proposalID } as any);
    expect(second.AlreadyEnacted).toBe(true);
    expect(second.EnactedMessageID).toBe(first.EnactedMessageID);
    expect(second.AcceptMessageID).toBeUndefined();

    // Still exactly one of each record.
    expect(await getDiplomaticMessages(1, 3, { messageType: 'deal-accept' })).toHaveLength(1);
    expect(await getDiplomaticMessages(1, 3, { messageType: 'deal-enacted' })).toHaveLength(1);
  });

  it('serializes concurrent enactment attempts so only one writes', async () => {
    const proposalID = await seedProposal();

    const results = await Promise.all([
      enact.execute({ ProposalMessageID: proposalID } as any),
      enact.execute({ ProposalMessageID: proposalID } as any),
    ]);

    expect(results.filter((result) => result.AlreadyEnacted)).toHaveLength(1);
    expect(results.filter((result) => !result.AlreadyEnacted)).toHaveLength(1);
    expect(await getDiplomaticMessages(1, 3, { messageType: 'deal-accept' })).toHaveLength(1);
    expect(await getDiplomaticMessages(1, 3, { messageType: 'deal-enacted' })).toHaveLength(1);
  });

  it('rolls back deal-accept when the deal-enacted insert fails', async () => {
    const proposalID = await seedProposal();
    await sql`
      CREATE TRIGGER fail_deal_enacted
      BEFORE INSERT ON DiplomaticMessages
      WHEN NEW.MessageType = 'deal-enacted'
      BEGIN
        SELECT RAISE(ABORT, 'forced enactment record failure');
      END
    `.execute(store.getDatabase());

    await expect(enact.execute({ ProposalMessageID: proposalID } as any)).rejects.toThrow();
    expect(await getDiplomaticMessages(1, 3, { messageType: 'deal-accept' })).toHaveLength(0);
    expect(await getDiplomaticMessages(1, 3, { messageType: 'deal-enacted' })).toHaveLength(0);
  });

  it('rejects a superseded proposal', async () => {
    const oldProposalID = await seedProposal();
    await seedProposal(1);
    await expect(enact.execute({ ProposalMessageID: oldProposalID } as any)).rejects.toThrow(
      /not the current active proposal/
    );
  });

  it('rejects a proposal that has already been rejected', async () => {
    const proposalID = await seedProposal();
    await append.execute({
      PlayerAID: 3,
      PlayerBID: 1,
      PlayerARole: 'negotiator',
      PlayerBRole: 'the leader',
      SpeakerID: 1,
      MessageType: 'deal-reject',
      Content: 'No.',
      Payload: { ProposalMessageID: proposalID },
    } as any);

    await expect(enact.execute({ ProposalMessageID: proposalID } as any)).rejects.toThrow(
      /not open/
    );
  });

  it('rejects malformed stored deal terms', async () => {
    const proposalID = await seedProposal(3, {});
    await expect(enact.execute({ ProposalMessageID: proposalID } as any)).rejects.toThrow(
      /invalid Payload\.Deal/
    );
  });

  it('rejects caller-supplied terms that differ from the stored proposal', async () => {
    const proposalID = await seedProposal();
    await expect(
      enact.execute({
        ProposalMessageID: proposalID,
        Deal: {
          version: 1,
          items: [{ fromPlayerID: 3, toPlayerID: 1, itemType: 'GOLD', amount: 50 }],
          promises: [],
        },
      } as any)
    ).rejects.toThrow(/does not match/);
  });

  it('matches caller-supplied terms that differ only in advisory fields or key order', async () => {
    // Stored proposal carries a rationale/message and one item.
    const proposalID = await seedProposal(3, {
      version: 1,
      items: [{ fromPlayerID: 3, toPlayerID: 1, itemType: 'GOLD', amount: 50 }],
      promises: [],
      rationale: 'They are desperate.',
      message: 'Fifty gold.',
    });

    // Caller passes the same game-relevant terms (no advisory fields, keys reordered) — must match.
    const result = await enact.execute({
      ProposalMessageID: proposalID,
      Deal: {
        version: 1,
        promises: [],
        items: [{ itemType: 'GOLD', toPlayerID: 1, amount: 50, fromPlayerID: 3 }],
      },
    } as any);

    expect(result.AlreadyEnacted).toBe(false);
    expect(typeof result.EnactedMessageID).toBe('number');
  });

  it('rejects a missing proposal', async () => {
    await expect(enact.execute({ ProposalMessageID: 9999 } as any)).rejects.toThrow(/does not exist/);
  });

  it('rejects a non-proposal message', async () => {
    const text = await append.execute({
      PlayerAID: 3, PlayerBID: 1, PlayerARole: 'negotiator', PlayerBRole: 'the leader',
      SpeakerID: 3, MessageType: 'text', Content: 'hi',
    } as any);
    await expect(enact.execute({ ProposalMessageID: text.ID } as any)).rejects.toThrow(/not a deal-proposal or deal-counter/);
  });
});
