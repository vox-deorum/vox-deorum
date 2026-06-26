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
  IllegalDealError,
  type InspectDealResult,
} from '../../../src/utils/diplomacy/deal.js';

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
    mcp.respondWith('append-message', structuredResult({ ID: 7, Turn: 4 }));

    const deal = { version: 1 as const, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD' as const, amount: 50 }], promises: [] };
    const out = await appendDealProposal(thread(), 1, 'deal-proposal', 'Here is my offer', deal);

    // GOLD carries no duration, so the stamped deal equals the input; the canonical deal is returned.
    expect(out).toEqual({ id: 7, turn: 4, inspection, deal });
    const append = mcp.calls('append-message')[0]!;
    expect(append.args.MessageType).toBe('deal-proposal');
    expect(append.args.SpeakerID).toBe(1);
    expect((append.args.Payload as Record<string, unknown>).Deal).toEqual(deal);
    expect((append.args.Payload as Record<string, unknown>).Value1).toEqual({ '0': 30 });
    expect((append.args.Payload as Record<string, unknown>).Value2).toEqual({ '0': 25 });
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
    mcp.respondWith('append-message', structuredResult({ ID: 11, Turn: 5 }));

    const deal = { version: 1 as const, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD_PER_TURN' as const, amount: 5 }], promises: [] };
    const out = await appendDealProposal(thread(), 1, 'deal-proposal', 'Tribute', deal);

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
    mcp.respondWith('append-message', structuredResult({ ID: 12, Turn: 5 }));

    const deal = { version: 1 as const, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD_PER_TURN' as const, amount: 5, duration: 1 }], promises: [] };
    const out = await appendDealProposal(thread(), 1, 'deal-proposal', 'Tribute', deal);

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
    mcp.respondWith('append-message', structuredResult({ ID: 21, Turn: 8 }));

    const deal = { version: 1 as const, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'DECLARATION_OF_FRIENDSHIP' as const }], promises: [] };
    const out = await appendDealProposal(thread(), 1, 'deal-proposal', 'Friends?', deal);

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
    mcp.respondWith('append-message', structuredResult({ ID: 22, Turn: 8 }));

    const deal = {
      version: 1 as const,
      items: [
        { fromPlayerID: 1, toPlayerID: 3, itemType: 'DEFENSIVE_PACT' as const },
        { fromPlayerID: 3, toPlayerID: 1, itemType: 'DEFENSIVE_PACT' as const },
      ],
      promises: [],
    };
    await appendDealProposal(thread(), 1, 'deal-proposal', 'Pact', deal);

    // No third item added — the deal was already mutual.
    const inspected = mcp.calls('inspect-deal')[0]!.args.ProposedDeal as { items: unknown[] };
    expect(inspected.items).toHaveLength(2);
    const stored = (mcp.calls('append-message')[0]!.args.Payload as Record<string, unknown>).Deal as { items: unknown[] };
    expect(stored.items).toHaveLength(2);
  });

  it('does not archive the proposal when inspection fails', async () => {
    mcp.failWith('inspect-deal', 'game busy');

    await expect(appendDealProposal(thread(), 1, 'deal-proposal', 'Offer', emptyDeal))
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
    await expect(appendDealProposal(thread(), 1, 'deal-proposal', 'Offer', deal)).rejects.toThrow(IllegalDealError);
    expect(mcp.calls('append-message')).toHaveLength(0);
  });

  it('rejects terms outside the conversation pair before inspection or archival', async () => {
    const malformed = {
      version: 1 as const,
      items: [{ fromPlayerID: 1, toPlayerID: 4, itemType: 'GOLD' as const, amount: 50 }],
      promises: [],
    };

    await expect(appendDealProposal(thread(), 1, 'deal-proposal', 'Offer', malformed))
      .rejects.toThrow('conversation endpoints');
    expect(mcp.calls('inspect-deal')).toHaveLength(0);
    expect(mcp.calls('append-message')).toHaveLength(0);
  });

  it('rejects targeted promises without a third-party target before archival', async () => {
    const malformed = {
      version: 1 as const,
      items: [],
      promises: [{ promiserID: 1, recipientID: 3, promiseType: 'COOP_WAR' as const }],
    };

    await expect(appendDealProposal(thread(), 1, 'deal-proposal', 'Offer', malformed))
      .rejects.toThrow('third-party targetPlayerID');
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
