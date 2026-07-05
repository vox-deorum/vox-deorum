/**
 * Tests for the diplomacy deal I/O wrappers (src/utils/diplomacy/deal.ts): the read-only
 * inspect-deal call, the typed deal-action transcript writes, value-snapshot computation,
 * and deal-message reading. Uses the shared mcpClient fixture — no live MCP server / game.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockMcpClient, structuredResult } from '../../helpers/mock-mcp-client.js';
import type { EnvoyThread } from '../../../src/types/index.js';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import {
  inspectDeal,
  computeValueMaps,
  appendDealProposal,
  appendDealReject,
  readDealMessages,
  reconcileDealRows,
  classifyDealSubmission,
  IllegalDealError,
  ProposalConflictError,
  type InspectDealResult,
} from '../../../src/utils/diplomacy/deal.js';
import type { MessageWithMetadata } from '../../../src/types/index.js';

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
});

/** Minimal diplomacy thread: ordered pair 1↔3, agent voices seat 3. */
function thread(partial: Partial<EnvoyThread> = {}): EnvoyThread {
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
    ...partial,
  };
}

const emptyDeal = { version: 1 as const, items: [], promises: [] };

/** A full `append-message` echo — the real tool returns the ordered canonical row (the source of the
 *  authoritative `row` appendDealProposal now builds). Override ID/Turn per test. */
const appendEcho = (over: Record<string, unknown> = {}) => structuredResult({
  ID: 7, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
  SpeakerID: 1, MessageType: 'deal-proposal', Content: '', Turn: 4, ...over,
});

describe('inspectDeal', () => {
  it('passes the pair and (optional) deal, unwrapping structuredContent', async () => {
    const result: InspectDealResult = { items: [], promises: [], tradableRange: { '1': {}, '3': {} } };
    mcp.respondWith('inspect-deal', structuredResult(result));

    const out = await inspectDeal(1, 3);
    expect(out.tradableRange).toHaveProperty('1');
    const call = mcp.calls('inspect-deal')[0]!;
    expect(call.args).toEqual({ PlayerAID: 1, PlayerBID: 3 });
  });

  it('includes ProposedDeal when a deal is given', async () => {
    mcp.respondWith('inspect-deal', structuredResult({ items: [], promises: [], tradableRange: {} }));
    await inspectDeal(1, 3, emptyDeal);
    expect(mcp.calls('inspect-deal')[0]!.args.ProposedDeal).toEqual(emptyDeal);
  });
});

describe('computeValueMaps', () => {
  it('keys per-item values by index from each ordered player perspective', () => {
    const inspection: InspectDealResult = {
      items: [
        { fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', legality: true, reasons: [], valueIfIGive: 30, valueIfIReceive: 25 },
        { fromPlayerID: 3, toPlayerID: 1, itemType: 'MAPS', legality: true, reasons: [], valueIfIGive: 10, valueIfIReceive: 12 },
      ],
      promises: [],
      tradableRange: {},
    };
    const { value1, value2 } = computeValueMaps(inspection, 1, 3);
    // item 0: player1 (id 1) is the giver → value-to-give 30; player2 (id 3) receives → 25.
    expect(value1['0']).toBe(30);
    expect(value2['0']).toBe(25);
    // item 1: player1 receives → 12; player2 (id 3) gives → 10.
    expect(value1['1']).toBe(12);
    expect(value2['1']).toBe(10);
  });
});

describe('appendDealProposal', () => {
  it('inspects for value snapshots, then appends deal-proposal with Deal + Value maps', async () => {
    const inspection: InspectDealResult = {
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', legality: true, reasons: [], valueIfIGive: 30, valueIfIReceive: 25 }],
      promises: [],
      tradableRange: {},
    };
    mcp.respondWith('inspect-deal', structuredResult(inspection));
    mcp.respondWith('append-message', appendEcho({ ID: 7, Turn: 4 }));

    const deal = { version: 1 as const, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD' as const, amount: 50 }], promises: [] };
    const out = await appendDealProposal(thread(), 1, 'deal-proposal', deal);

    // GOLD carries no duration, so the stamped deal equals the input; the canonical deal is returned.
    expect(out).toMatchObject({ id: 7, turn: 4, inspection, deal });
    // The authoritative committed row carries the real ID + value snapshots — emitted over SSE with no reread.
    expect(out.row).toMatchObject({
      ID: 7, Turn: 4, SpeakerID: 1, MessageType: 'deal-proposal',
      Payload: { Deal: deal, Value1: { '0': 30 }, Value2: { '0': 25 } },
    });
    const append = mcp.calls('append-message')[0]!;
    expect(append.args.MessageType).toBe('deal-proposal');
    expect(append.args.SpeakerID).toBe(1);
    expect((append.args.Payload as Record<string, unknown>).Deal).toEqual(deal);
    expect((append.args.Payload as Record<string, unknown>).Value1).toEqual({ '0': 30 });
    expect((append.args.Payload as Record<string, unknown>).Value2).toEqual({ '0': 25 });
  });

  it('derives the stored Content from deal.message (no separate content arg)', async () => {
    mcp.respondWith('inspect-deal', structuredResult({ items: [], promises: [], tradableRange: {} }));
    mcp.respondWith('append-message', appendEcho({ ID: 8, Turn: 4 }));

    const deal = { version: 1 as const, items: [], promises: [], message: 'Lets be friends.' };
    await appendDealProposal(thread(), 1, 'deal-proposal', deal);
    expect(mcp.calls('append-message')[0]!.args.Content).toBe('Lets be friends.');
  });

  it('falls back to a per-type default Content when deal.message is blank', async () => {
    mcp.respondWith('inspect-deal', structuredResult({ items: [], promises: [], tradableRange: {} }));
    mcp.respondWith('append-message', appendEcho({ ID: 9, Turn: 4, MessageType: 'deal-counter' }));

    await appendDealProposal(thread(), 1, 'deal-counter', { version: 1 as const, items: [], promises: [] });
    expect(mcp.calls('append-message')[0]!.args.Content).toBe('A deal was countered.');
  });

  it('stamps the fixed per-type duration onto duration-bearing terms before archival', async () => {
    // The proposer (agent or UI) supplies no duration; appendDealProposal fills it from the
    // inspection's game-speed durations so the stored/returned deal never carries a missing duration.
    const inspection: InspectDealResult = {
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD_PER_TURN', legality: true, reasons: [], valueIfIGive: 90, valueIfIReceive: 80 }],
      promises: [],
      tradableRange: {},
      defaultDuration: 30,
      peaceDuration: 10,
      relationshipDuration: 25,
    };
    mcp.respondWith('inspect-deal', structuredResult(inspection));
    mcp.respondWith('append-message', appendEcho({ ID: 11, Turn: 5 }));

    const deal = { version: 1 as const, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD_PER_TURN' as const, amount: 5 }], promises: [] };
    const out = await appendDealProposal(thread(), 1, 'deal-proposal', deal);

    const stampedItem = { fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD_PER_TURN', amount: 5, duration: 30 };
    expect(out.deal.items[0]).toEqual(stampedItem);
    expect((mcp.calls('append-message')[0]!.args.Payload as Record<string, unknown>).Deal).toEqual({
      version: 1,
      items: [stampedItem],
      promises: [],
    });
  });

  it('treats duration as read-only: a stale authored duration is overwritten with the fixed game value', async () => {
    // Durations are fixed game constants; an authored value must never survive to the stored deal
    // (and the inspection that produced Value1/Value2 evaluates at the same fixed length on the Lua side).
    const inspection: InspectDealResult = {
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD_PER_TURN', legality: true, reasons: [], valueIfIGive: 90, valueIfIReceive: 80 }],
      promises: [],
      tradableRange: {},
      defaultDuration: 30,
    };
    mcp.respondWith('inspect-deal', structuredResult(inspection));
    mcp.respondWith('append-message', appendEcho({ ID: 12, Turn: 5 }));

    const deal = { version: 1 as const, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD_PER_TURN' as const, amount: 5, duration: 1 }], promises: [] };
    const out = await appendDealProposal(thread(), 1, 'deal-proposal', deal);

    expect(out.deal.items[0]!.duration).toBe(30);
    expect(((mcp.calls('append-message')[0]!.args.Payload as Record<string, unknown>).Deal as { items: Array<{ duration?: number }> }).items[0]!.duration).toBe(30);
  });

  it('completes a one-sided mutual agreement onto both sides before inspecting and archiving', async () => {
    // A Declaration of Friendship binds both sides; appendDealProposal mirrors the one-sided term so
    // the inspected and stored deal are symmetric — the same completion the in-game trade screen does.
    const inspection: InspectDealResult = {
      items: [
        { fromPlayerID: 1, toPlayerID: 3, itemType: 'DECLARATION_OF_FRIENDSHIP', legality: true, reasons: [], valueIfIGive: 0, valueIfIReceive: 0 },
        { fromPlayerID: 3, toPlayerID: 1, itemType: 'DECLARATION_OF_FRIENDSHIP', legality: true, reasons: [], valueIfIGive: 0, valueIfIReceive: 0 },
      ],
      promises: [],
      tradableRange: {},
      defaultDuration: 30,
      relationshipDuration: 25,
    };
    mcp.respondWith('inspect-deal', structuredResult(inspection));
    mcp.respondWith('append-message', appendEcho({ ID: 21, Turn: 8 }));

    const deal = { version: 1 as const, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'DECLARATION_OF_FRIENDSHIP' as const }], promises: [] };
    const out = await appendDealProposal(thread(), 1, 'deal-proposal', deal);

    // inspect-deal saw the mirrored (symmetric) deal...
    const inspected = mcp.calls('inspect-deal')[0]!.args.ProposedDeal as { items: unknown[] };
    expect(inspected.items).toHaveLength(2);
    // ...and the stored/returned deal carries both directions, each stamped with the relationship duration.
    const stored = (mcp.calls('append-message')[0]!.args.Payload as Record<string, unknown>).Deal as { items: unknown[] };
    expect(stored.items).toEqual([
      { fromPlayerID: 1, toPlayerID: 3, itemType: 'DECLARATION_OF_FRIENDSHIP', duration: 25 },
      { fromPlayerID: 3, toPlayerID: 1, itemType: 'DECLARATION_OF_FRIENDSHIP', duration: 25 },
    ]);
    expect(out.deal.items).toHaveLength(2);
  });

  it('leaves an already-symmetric mutual agreement unchanged (idempotent)', async () => {
    const inspection: InspectDealResult = {
      items: [
        { fromPlayerID: 1, toPlayerID: 3, itemType: 'DEFENSIVE_PACT', legality: true, reasons: [], valueIfIGive: 0, valueIfIReceive: 0 },
        { fromPlayerID: 3, toPlayerID: 1, itemType: 'DEFENSIVE_PACT', legality: true, reasons: [], valueIfIGive: 0, valueIfIReceive: 0 },
      ],
      promises: [],
      tradableRange: {},
      defaultDuration: 30,
    };
    mcp.respondWith('inspect-deal', structuredResult(inspection));
    mcp.respondWith('append-message', appendEcho({ ID: 22, Turn: 8 }));

    const deal = {
      version: 1 as const,
      items: [
        { fromPlayerID: 1, toPlayerID: 3, itemType: 'DEFENSIVE_PACT' as const },
        { fromPlayerID: 3, toPlayerID: 1, itemType: 'DEFENSIVE_PACT' as const },
      ],
      promises: [],
    };
    await appendDealProposal(thread(), 1, 'deal-proposal', deal);

    // No third item added — the deal was already mutual.
    const inspected = mcp.calls('inspect-deal')[0]!.args.ProposedDeal as { items: unknown[] };
    expect(inspected.items).toHaveLength(2);
    const stored = (mcp.calls('append-message')[0]!.args.Payload as Record<string, unknown>).Deal as { items: unknown[] };
    expect(stored.items).toHaveLength(2);
  });

  it('does not archive the proposal when inspection fails', async () => {
    mcp.failWith('inspect-deal', 'game busy');

    await expect(appendDealProposal(thread(), 1, 'deal-proposal', emptyDeal))
      .rejects.toThrow('Could not inspect deal before storing proposal');
    expect(mcp.calls('append-message')).toHaveLength(0);
  });

  it('hard-rejects (IllegalDealError) a proposal with an untradeable item, archiving nothing', async () => {
    // Legality is enforced, not advisory: a deal carrying an illegal term is refused before the
    // archival write — covering both the UI route and the negotiator that share this function.
    const inspection: InspectDealResult = {
      items: [
        { fromPlayerID: 1, toPlayerID: 3, itemType: 'RESOURCES', legality: false, reasons: ['Bonus resources cannot be traded.'], valueIfIGive: 0, valueIfIReceive: 0 },
      ],
      promises: [],
      tradableRange: {},
    };
    mcp.respondWith('inspect-deal', structuredResult(inspection));

    const deal = {
      version: 1 as const,
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'RESOURCES' as const, resourceID: 9, quantity: 1 }],
      promises: [],
    };
    const err = await appendDealProposal(thread(), 1, 'deal-proposal', deal).catch((e) => e);
    expect(err).toBeInstanceOf(IllegalDealError);
    // The message uses the friendly, data-bearing item label and civ-name fallback ("Player <id>" with
    // no identities set) — never the raw enum. It reaches the UI toast verbatim.
    expect(err.message).toContain('Resource #9 ×1 (Player 1 → Player 3): Bonus resources cannot be traded.');
    expect(err.message).not.toContain('RESOURCES');
    // Structured details let the negotiator reframe Give/Take without parsing the message.
    expect(err.details).toEqual([
      { itemType: 'RESOURCES', fromPlayerID: 1, toPlayerID: 3, reasons: ['Bonus resources cannot be traded.'] },
    ]);
    expect(mcp.calls('append-message')).toHaveLength(0);
  });

  it('names the illegal item and civs with friendly labels when the thread carries identities', async () => {
    // The reported bug: DECLARATION_OF_FRIENDSHIP (4→1) → a friendly "Declaration of Friendship
    // (Rome → Egypt)". Civ names come from the thread's stored identities; the label from the item type.
    const inspection: InspectDealResult = {
      items: [
        { fromPlayerID: 1, toPlayerID: 3, itemType: 'DECLARATION_OF_FRIENDSHIP', legality: false, reasons: ['Not tradeable under current game state'], valueIfIGive: 0, valueIfIReceive: 0 },
      ],
      promises: [],
      tradableRange: {},
    };
    mcp.respondWith('inspect-deal', structuredResult(inspection));

    const deal = {
      version: 1 as const,
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'DECLARATION_OF_FRIENDSHIP' as const }],
      promises: [],
    };
    const named = thread({
      player1Identity: { name: 'Rome', leader: 'Augustus' },
      player2Identity: { name: 'Egypt', leader: 'Cleopatra' },
    });
    const err = await appendDealProposal(named, 1, 'deal-proposal', deal).catch((e) => e);
    expect(err).toBeInstanceOf(IllegalDealError);
    expect(err.message).toContain('Declaration of Friendship (Rome → Egypt)');
    expect(err.message).not.toContain('DECLARATION_OF_FRIENDSHIP');
    expect(mcp.calls('append-message')).toHaveLength(0);
  });

  it('rejects (IllegalDealError) terms outside the conversation pair before inspection or archival', async () => {
    // A malformed endpoint is a client error: throwing IllegalDealError lets the route map it to 400
    // (not a generic 502). The message still names the offending field for the model/UI.
    const malformed = {
      version: 1 as const,
      items: [{ fromPlayerID: 1, toPlayerID: 4, itemType: 'GOLD' as const, amount: 50 }],
      promises: [],
    };

    await expect(appendDealProposal(thread(), 1, 'deal-proposal', malformed)).rejects.toThrow(IllegalDealError);
    await expect(appendDealProposal(thread(), 1, 'deal-proposal', malformed)).rejects.toThrow('conversation endpoints');
    expect(mcp.calls('inspect-deal')).toHaveLength(0);
    expect(mcp.calls('append-message')).toHaveLength(0);
  });

  it('rejects (IllegalDealError) targeted promises without a third-party target before archival', async () => {
    const malformed = {
      version: 1 as const,
      items: [],
      promises: [{ promiserID: 1, recipientID: 3, promiseType: 'COOP_WAR' as const }],
    };

    await expect(appendDealProposal(thread(), 1, 'deal-proposal', malformed)).rejects.toThrow(IllegalDealError);
    await expect(appendDealProposal(thread(), 1, 'deal-proposal', malformed)).rejects.toThrow('third-party targetPlayerID');
    expect(mcp.calls('inspect-deal')).toHaveLength(0);
    expect(mcp.calls('append-message')).toHaveLength(0);
  });

  // Non-honored promises (SPY / NO_CONVERT / city-state) are not in the contract at all, so
  // `DealPayloadSchema` rejects them at the parse boundary both writer paths share — there is no
  // separate "offered" guard in appendDealProposal to test. (Schema rejection is covered in
  // mcp-server's deal-schema.test.ts.)
});

describe('appendDealReject', () => {
  it('appends deal-reject referencing the proposal message ID', async () => {
    mcp.respondWith('append-message', structuredResult({ ID: 9, Turn: 6 }));
    await appendDealReject(thread(), 1, 'No thanks', 7);
    const args = mcp.calls('append-message')[0]!.args;
    expect(args.MessageType).toBe('deal-reject');
    expect((args.Payload as Record<string, unknown>).ProposalMessageID).toBe(7);
  });

  it('throws when append-message returns no numeric ID (store-contract violation)', async () => {
    mcp.respondWith('append-message', structuredResult({ Turn: 6 }));
    await expect(appendDealReject(thread(), 1, 'No thanks', 7)).rejects.toThrow('numeric ID');
  });
});

describe('classifyDealSubmission', () => {
  /** A stored proposal row authored by the agent (seat 3) for the ordered pair 1↔3. */
  const proposalRow = (over: Record<string, unknown> = {}) => ({
    ID: 7, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
    SpeakerID: 3, MessageType: 'deal-proposal', Content: 'Offer',
    Payload: { Deal: emptyDeal }, Turn: 4, CreatedAt: 0, ...over,
  });

  it('classifies as deal-counter when the expected ID is still the active open offer (no author check)', async () => {
    mcp.respondWith('read-transcript', structuredResult({ messages: [proposalRow()] }));
    await expect(classifyDealSubmission(thread(), 7)).resolves.toBe('deal-counter');
  });

  it('classifies as deal-proposal when none is open and the submitter expected none', async () => {
    mcp.respondWith('read-transcript', structuredResult({ messages: [] }));
    await expect(classifyDealSubmission(thread(), undefined)).resolves.toBe('deal-proposal');
  });

  it('throws ProposalConflictError when a different proposal became active', async () => {
    // The human reviewed 7, but 9 is the active offer now — a stale submission must not revive 7.
    mcp.respondWith('read-transcript', structuredResult({ messages: [proposalRow({ ID: 9 })] }));
    await expect(classifyDealSubmission(thread(), 7)).rejects.toBeInstanceOf(ProposalConflictError);
    await expect(classifyDealSubmission(thread(), 7)).rejects.toThrow(/no longer the active proposal/i);
  });

  it('throws ProposalConflictError when the expected proposal was rejected under the actor', async () => {
    const rejectRow = {
      ID: 8, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
      SpeakerID: 1, MessageType: 'deal-reject', Content: '', Payload: { ProposalMessageID: 7 }, Turn: 4, CreatedAt: 1,
    };
    mcp.respondWith('read-transcript', structuredResult({ messages: [proposalRow(), rejectRow] }));
    await expect(classifyDealSubmission(thread(), 7)).rejects.toBeInstanceOf(ProposalConflictError);
  });

  it('throws ProposalConflictError when a fresh proposal would supersede an open offer', async () => {
    // The submitter believed nothing was open (undefined) but offer 7 is — a fresh proposal must not
    // silently supersede it. This is the propose-direction of the same under-lock reconcile.
    mcp.respondWith('read-transcript', structuredResult({ messages: [proposalRow()] }));
    await expect(classifyDealSubmission(thread(), undefined)).rejects.toBeInstanceOf(ProposalConflictError);
    await expect(classifyDealSubmission(thread(), undefined)).rejects.toThrow(/must be answered/i);
  });
});

describe('readDealMessages', () => {
  it('filters the transcript to deal-related message types only', async () => {
    mcp.respondWith('read-transcript', structuredResult({ messages: [
      { ID: 1, MessageType: 'text' },
      { ID: 2, MessageType: 'deal-proposal' },
      { ID: 3, MessageType: 'close' },
      { ID: 4, MessageType: 'deal-reject' },
    ] }));
    const out = await readDealMessages(1, 3);
    expect(out.map((m) => m.ID)).toEqual([2, 4]);
  });
});

describe('reconcileDealRows', () => {
  /** A stored deal row with sensible defaults for the ordered pair 1↔3. */
  const dealRow = (over: Record<string, unknown>) => ({
    ID: 0, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
    SpeakerID: 1, MessageType: 'deal-proposal', Content: '', Payload: {}, Turn: 5, CreatedAt: 0, ...over,
  });

  it('appends only the deal rows not already in the cache, leaving existing rows untouched', async () => {
    // The store now also holds a deal-enacted answering the proposal already on the thread.
    mcp.respondWith('read-transcript', structuredResult({ messages: [
      dealRow({ ID: 7, MessageType: 'deal-proposal', Payload: { Deal: emptyDeal } }),
      dealRow({ ID: 10, MessageType: 'deal-enacted', SpeakerID: 3, Payload: { ProposalMessageID: 7 } }),
    ] }));

    // Live cache: a plain user line, the existing proposal (deal ID 7), and a reasoning/trace row —
    // the kinds of in-memory content a full re-hydrate would discard.
    const userRow: MessageWithMetadata = { message: { role: 'user', content: 'hi' }, metadata: { datetime: new Date(), turn: 5 } };
    const proposalRow: MessageWithMetadata = {
      message: { role: 'assistant', content: 'offer' }, metadata: { datetime: new Date(), turn: 5 },
      deal: dealRow({ ID: 7, MessageType: 'deal-proposal', SpeakerID: 3, Payload: { Deal: emptyDeal } }) as MessageWithMetadata['deal'],
    };
    const traceRow: MessageWithMetadata = { message: { role: 'assistant', content: 'thinking…' }, metadata: { datetime: new Date(), turn: 5 } };
    const t = thread({ messages: [userRow, proposalRow, traceRow] });

    await reconcileDealRows(t);

    // The enacted row is appended; the proposal (already present by ID) is not duplicated.
    expect(t.messages).toHaveLength(4);
    expect(t.messages[3]!.deal?.ID).toBe(10);
    expect(t.messages[3]!.deal?.MessageType).toBe('deal-enacted');
    // Existing rows are the exact same objects — live traces preserved, nothing re-hydrated.
    expect(t.messages[0]).toBe(userRow);
    expect(t.messages[1]).toBe(proposalRow);
    expect(t.messages[2]).toBe(traceRow);
  });

  it('is a no-op when every stored deal row is already mirrored', async () => {
    mcp.respondWith('read-transcript', structuredResult({ messages: [
      dealRow({ ID: 7, MessageType: 'deal-proposal', Payload: { Deal: emptyDeal } }),
    ] }));
    const proposalRow: MessageWithMetadata = {
      message: { role: 'assistant', content: 'offer' }, metadata: { datetime: new Date(), turn: 5 },
      deal: dealRow({ ID: 7, MessageType: 'deal-proposal', Payload: { Deal: emptyDeal } }) as MessageWithMetadata['deal'],
    };
    const t = thread({ messages: [proposalRow] });

    await reconcileDealRows(t);

    expect(t.messages).toHaveLength(1);
    expect(t.messages[0]).toBe(proposalRow);
  });
});
