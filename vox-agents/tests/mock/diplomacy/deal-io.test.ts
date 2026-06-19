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

    expect(out).toEqual({ id: 7, turn: 4, inspection });
    const append = mcp.calls('append-message')[0]!;
    expect(append.args.MessageType).toBe('deal-proposal');
    expect(append.args.SpeakerID).toBe(1);
    expect((append.args.Payload as Record<string, unknown>).Deal).toEqual(deal);
    expect((append.args.Payload as Record<string, unknown>).Value1).toEqual({ '0': 30 });
    expect((append.args.Payload as Record<string, unknown>).Value2).toEqual({ '0': 25 });
  });

  it('does not archive the proposal when inspection fails', async () => {
    mcp.failWith('inspect-deal', 'game busy');

    await expect(appendDealProposal(thread(), 1, 'deal-proposal', 'Offer', emptyDeal))
      .rejects.toThrow('Could not inspect deal before storing proposal');
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
    mcp.respondWith('read-transcript', structuredResult([
      { ID: 1, MessageType: 'text' },
      { ID: 2, MessageType: 'deal-proposal' },
      { ID: 3, MessageType: 'close' },
      { ID: 4, MessageType: 'deal-reject' },
    ]));
    const out = await readDealMessages(1, 3);
    expect(out.map((m) => m.ID)).toEqual([2, 4]);
  });
});
