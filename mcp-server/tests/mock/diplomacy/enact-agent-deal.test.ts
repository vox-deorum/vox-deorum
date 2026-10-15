/**
 * Tests for the stage-6 enact-agent-deal tool: it enacts the deal in-game (via the mocked
 * `enactDeal` bridge call), records deal-accept + deal-enacted against a proposal, and is
 * idempotent on the proposal's deal-enacted record. A bridge error or un-enacted result now
 * throws and writes nothing. Runs against an in-memory KnowledgeStore with `enactDeal` stubbed —
 * no real bridge-service / DLL.
 *
 * Stage 7.04 added the failure split these tests also pin: a lost race over proposal state
 * (superseded / answered / wrong recipient) returns a structured `Conflict` instead of throwing,
 * while validation and infrastructure failures keep throwing — and the success and idempotent
 * paths now also carry the full durable `AcceptRow` / `EnactedRow` projections.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sql } from 'kysely';
import createAppendMessageTool from '../../../src/tools/actions/append-message.js';
import createEnactAgentDealTool from '../../../src/tools/actions/enact-agent-deal.js';
import createRejectAgentDealTool from '../../../src/tools/actions/reject-agent-deal.js';
import createReadTranscriptTool from '../../../src/tools/knowledge/read-transcript.js';
import { setupDiplomacyStore, seedPlayer } from '../helpers.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import * as inspectDealUtil from '../../../src/utils/lua/inspect-deal.js';
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

beforeEach(async () => {
  store = await setupDiplomacyStore(10);
  await seedPlayer(store, 1);
  await seedPlayer(store, 3);
  // Enactment calls the DLL enact path via the bridge. These store-only tests have no bridge, so
  // stub it to report a successful enactment by default (individual tests override to fail/refuse).
  vi.spyOn(inspectDealUtil, 'enactDeal').mockResolvedValue({
    enacted: true,
    items: [],
  } as any);
  client = await connectToolClient(append, enact, reject, read);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await client.close();
  await store.close();
});

describe('enact-agent-deal', () => {
  it('enacts the deal and records deal-accept + deal-enacted, accepter defaulting to the recipient', async () => {
    const proposalID = await seedProposal();

    const result = await client.call({ ProposalMessageID: proposalID }, enact.name);

    expect(result.AlreadyEnacted).toBe(false);
    expect(result.Enacted).toBe(true); // enacted in-game (mocked bridge)
    expect(typeof result.AcceptMessageID).toBe('number');
    expect(typeof result.EnactedMessageID).toBe('number');
    expect(result.Conflict).toBeUndefined();

    const accepts = await readMessages(1, 3, 'deal-accept');
    const enacted = await readMessages(1, 3, 'deal-enacted');
    expect(accepts).toHaveLength(1);
    expect(enacted).toHaveLength(1);
    // The recipient (seat 1) is the accepter — the endpoint that did not author the proposal.
    expect(accepts[0].SpeakerID).toBe(1);
    expect((accepts[0].Payload as any).ProposalMessageID).toBe(proposalID);
    expect((enacted[0].Payload as any).ProposalMessageID).toBe(proposalID);
  });

  it('returns full AcceptRow / EnactedRow projections matching the durable rows', async () => {
    // A caller hydrates its live transcript cache from these rows instead of rereading the
    // transcript, so each must equal the stored row field for field.
    const proposalID = await seedProposal();

    const result = await client.call({ ProposalMessageID: proposalID, Content: 'Agreed.' }, enact.name);

    const [storedAccept] = await readMessages(1, 3, 'deal-accept');
    const [storedEnacted] = await readMessages(1, 3, 'deal-enacted');
    expect(result.AcceptRow).toMatchObject(storedAccept);
    expect(result.EnactedRow).toMatchObject(storedEnacted);
    expect(result.AcceptRow).toMatchObject({ ID: result.AcceptMessageID, SpeakerID: 1, Payload: { ProposalMessageID: proposalID } });
    expect(result.EnactedRow).toMatchObject({ ID: result.EnactedMessageID, Payload: { ProposalMessageID: proposalID } });
  });

  it('is idempotent — a second enactment refuses and writes nothing new', async () => {
    const proposalID = await seedProposal();
    const first = await client.call({ ProposalMessageID: proposalID }, enact.name);

    const second = await client.call({ ProposalMessageID: proposalID }, enact.name);
    expect(second.AlreadyEnacted).toBe(true);
    expect(second.Enacted).toBe(false);
    expect(second.EnactedMessageID).toBe(first.EnactedMessageID);
    expect(second.AcceptMessageID).toBeUndefined();
    expect(second.Conflict).toBeUndefined();
    // The idempotent path returns the EXISTING enacted row (and no AcceptRow, since this call
    // wrote nothing), so a caller re-pushing it publishes the row that actually exists.
    expect(second.EnactedRow).toEqual(first.EnactedRow);
    expect(second.AcceptRow).toBeUndefined();

    // Still exactly one of each record.
    expect(await readMessages(1, 3, 'deal-accept')).toHaveLength(1);
    expect(await readMessages(1, 3, 'deal-enacted')).toHaveLength(1);
  });

  it('serializes concurrent enactment attempts so only one writes', async () => {
    const proposalID = await seedProposal();

    const results = await Promise.all([
      client.call({ ProposalMessageID: proposalID }, enact.name),
      client.call({ ProposalMessageID: proposalID }, enact.name),
    ]);

    expect(results.filter((result) => result.AlreadyEnacted)).toHaveLength(1);
    expect(results.filter((result) => !result.AlreadyEnacted)).toHaveLength(1);
    expect(await readMessages(1, 3, 'deal-accept')).toHaveLength(1);
    expect(await readMessages(1, 3, 'deal-enacted')).toHaveLength(1);
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

    await expect(client.call({ ProposalMessageID: proposalID }, enact.name)).rejects.toThrow();
    expect(await readMessages(1, 3, 'deal-accept')).toHaveLength(0);
    expect(await readMessages(1, 3, 'deal-enacted')).toHaveLength(0);
  });

  it('reports a superseded proposal as a structured conflict, not a thrown error', async () => {
    const oldProposalID = await seedProposal();
    await seedProposal(1);

    const result = await client.call({ ProposalMessageID: oldProposalID }, enact.name);

    expect(result.Conflict?.Reason).toBe('superseded');
    expect(result.ProposalMessageID).toBe(oldProposalID);
    // A conflict enacted nothing, so every enactment field is absent.
    expect(result.EnactedMessageID).toBeUndefined();
    expect(result.AlreadyEnacted).toBeUndefined();
    expect(result.Enacted).toBeUndefined();
    expect(result.Turn).toBeUndefined();
    expect(result.AcceptRow).toBeUndefined();
    expect(result.EnactedRow).toBeUndefined();
    expect(await readMessages(1, 3, 'deal-accept')).toHaveLength(0);
  });

  it('reports a proposal that was already rejected as an answered conflict', async () => {
    const proposalID = await seedProposal();
    // Rejection now goes through its own transactional route; append-message refuses deal-reject.
    await client.call({
      PlayerAID: 3, PlayerBID: 1, ProposalMessageID: proposalID, SpeakerID: 1, Content: 'No.',
    }, reject.name);

    const result = await client.call({ ProposalMessageID: proposalID }, enact.name);

    expect(result.Conflict).toEqual({
      Reason: 'answered',
      Message: expect.any(String),
    });
    expect(result.Enacted).toBeUndefined();
    expect(await readMessages(1, 3, 'deal-accept')).toHaveLength(0);
  });

  it('reports a non-recipient accepter as a wrong-recipient conflict', async () => {
    // This covers the proposal author accepting its own proposal too: in practice a caller only
    // sends the author as accepter after prechecking against a proposal that has since been
    // replaced, which is a lost race, so it is refused as a wrong-recipient conflict rather
    // than a thrown error.
    const proposalID = await seedProposal(); // authored by seat 3
    const result = await client.call({ ProposalMessageID: proposalID, AccepterID: 3 }, enact.name);

    expect(result.Conflict?.Reason).toBe('wrong-recipient');
    expect(await readMessages(1, 3, 'deal-enacted')).toHaveLength(0);
  });

  it('rejects malformed stored deal terms', async () => {
    const proposalID = await seedProposal(3, {});
    await expect(client.call({ ProposalMessageID: proposalID }, enact.name)).rejects.toThrow();
    expect(await readMessages(1, 3, 'deal-accept')).toHaveLength(0);
  });

  it('rejects caller-supplied terms that differ from the stored proposal', async () => {
    const proposalID = await seedProposal();
    await expect(
      client.call({
        ProposalMessageID: proposalID,
        Deal: {
          version: 1,
          items: [{ fromPlayerID: 3, toPlayerID: 1, itemType: 'GOLD', amount: 50 }],
          promises: [],
        },
      }, enact.name)
    ).rejects.toThrow();
    expect(await readMessages(1, 3, 'deal-accept')).toHaveLength(0);
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
    const result = await client.call({
      ProposalMessageID: proposalID,
      Deal: {
        version: 1,
        promises: [],
        items: [{ itemType: 'GOLD', toPlayerID: 1, amount: 50, fromPlayerID: 3 }],
      },
    }, enact.name);

    expect(result.AlreadyEnacted).toBe(false);
    expect(typeof result.EnactedMessageID).toBe('number');
  });

  it('rejects a missing proposal', async () => {
    await expect(client.call({ ProposalMessageID: 9999 }, enact.name)).rejects.toThrow();
  });

  it('rejects a non-proposal message', async () => {
    const text = await client.call({
      PlayerAID: 3, PlayerBID: 1, PlayerARole: 'negotiator', PlayerBRole: 'the leader',
      SpeakerID: 3, MessageType: 'text', Content: 'hi',
    }, append.name);
    await expect(client.call({ ProposalMessageID: text.ID }, enact.name)).rejects.toThrow();
  });

  it('refuses to enact a deal the DLL reports as un-enacted, writing nothing', async () => {
    const proposalID = await seedProposal(3, {
      version: 1,
      items: [{ fromPlayerID: 3, toPlayerID: 1, itemType: 'RESEARCH_AGREEMENT' }],
      promises: [],
    });
    // The deal turned illegal between authoring and acceptance (e.g. a rule/state change), so the
    // enact-mode script validates up front, writes nothing, and returns enacted = false + reasons.
    vi.spyOn(inspectDealUtil, 'enactDeal').mockResolvedValue({
      enacted: false,
      reasons: ['Item 1 (RESEARCH_AGREEMENT): Research agreements are disabled.'],
      items: [],
    } as any);

    await expect(client.call({ ProposalMessageID: proposalID }, enact.name)).rejects.toThrow();
    expect(await readMessages(1, 3, 'deal-accept')).toHaveLength(0);
    expect(await readMessages(1, 3, 'deal-enacted')).toHaveLength(0);
  });

  it('throws and writes nothing when the bridge is unavailable (null) — inverted from the stage-5 stub', async () => {
    const proposalID = await seedProposal();
    vi.spyOn(inspectDealUtil, 'enactDeal').mockResolvedValue(null as any);

    await expect(client.call({ ProposalMessageID: proposalID }, enact.name)).rejects.toThrow();
    expect(await readMessages(1, 3, 'deal-accept')).toHaveLength(0);
    expect(await readMessages(1, 3, 'deal-enacted')).toHaveLength(0);
  });

  it('enacts a promise-only / item-less deal', async () => {
    const proposalID = await seedProposal(3, {
      version: 1,
      items: [],
      promises: [{ promiserID: 3, recipientID: 1, promiseType: 'MILITARY' }],
    });
    // The enact-mode script applies the promise and Deal:Enact is a no-op returning true for no items.
    vi.spyOn(inspectDealUtil, 'enactDeal').mockResolvedValue({ enacted: true, items: [] } as any);

    const result = await client.call({ ProposalMessageID: proposalID }, enact.name);
    expect(result.Enacted).toBe(true);
    expect(typeof result.EnactedMessageID).toBe('number');
    expect(await readMessages(1, 3, 'deal-enacted')).toHaveLength(1);
  });
});
