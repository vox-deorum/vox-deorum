/**
 * Tests for the diplomacy deal I/O wrappers (src/utils/diplomacy/deal.ts): the read-only
 * inspect-deal call, the typed deal-action transcript writes, value-snapshot computation,
 * and deal-message reading. Uses the shared mcpClient fixture — no live MCP server / game.
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

import {
  inspectDeal,
  computeValueMaps,
  appendDealProposal,
  appendDealReject,
  readDealMessages,
  classifyDealSubmission,
  requireCurrentOpenProposal,
  IllegalDealError,
  ProposalConflictError,
  type InspectDealResult,
} from '../../../../src/utils/diplomacy/deal/deal.js';
import { beginTurnState } from '../../../../src/utils/diplomacy/turn/active-turn-state.js';

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
    // Structured details let the negotiator reframe Give/Receive without parsing the message. The
    // `kind` discriminant tells an untradeable item from an impossible promise.
    // `label` carries the same full display label (amount included) the message line just used,
    // so a downstream reframe (the negotiator's Give/Receive feedback) never has to fall back to
    // the bare item-type name.
    expect(err.details).toEqual([
      {
        kind: 'item',
        itemType: 'RESOURCES',
        fromPlayerID: 1,
        toPlayerID: 3,
        reasons: ['Bonus resources cannot be traded.'],
        label: 'Resource #9 ×1',
      },
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

  it('reports the committed proposal row to the turn observing the thread', async () => {
    mcp.respondWith('inspect-deal', structuredResult({ items: [], promises: [], tradableRange: {} }));
    mcp.respondWith('append-message', appendEcho({ ID: 41, Turn: 6 }));
    const t = thread();
    const turnState = beginTurnState(t);

    const out = await appendDealProposal(t, 1, 'deal-proposal', emptyDeal);

    // The negotiator's mid-run proposal reaches the client through the running turn's rows — no
    // transcript reread. The captured object is the exact authoritative row the append returned.
    expect(turnState.freeze()).toEqual([out.row]);
  });
});

describe('appendDealProposal at war (automatic Peace Treaty)', () => {
  /**
   * An inspect-deal handler whose per-item verdicts stay index-aligned with whatever deal the call
   * sent, so the re-inspection after the treaty is added sees its own terms (all legal unless the
   * `overrides` say otherwise, e.g. `atWar`).
   */
  const inspectEcho = (overrides: Record<string, unknown> = {}) => (args: Record<string, unknown>) => {
    const sent = args.ProposedDeal as { items: Array<Record<string, unknown>> };
    return structuredResult({
      items: sent.items.map((item) => ({
        ...item,
        legality: true,
        reasons: [],
        valueIfIGive: 10,
        valueIfIReceive: 10,
      })),
      promises: [],
      tradableRange: {},
      ...overrides,
    });
  };
  const goldDeal = {
    version: 1 as const,
    items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD' as const, amount: 50 }],
    promises: [],
  };

  it('adds a Peace Treaty in both directions and re-inspects when the pair is at war', async () => {
    // The authored deal carries no treaty; the stored one must, and the second inspection is what
    // makes the added term's legality and value real.
    mcp.onTool('inspect-deal', inspectEcho({ atWar: true }));
    mcp.respondWith('append-message', appendEcho({ ID: 61, Turn: 9 }));

    const out = await appendDealProposal(thread(), 1, 'deal-proposal', goldDeal);

    const inspected = mcp.calls('inspect-deal');
    expect(inspected).toHaveLength(2);
    const secondSent = (inspected[1]!.args.ProposedDeal as { items: Array<{ itemType: string }> }).items;
    expect(secondSent.filter((i) => i.itemType === 'PEACE_TREATY')).toHaveLength(2);

    const stored = (mcp.calls('append-message')[0]!.args.Payload as Record<string, unknown>).Deal as {
      items: Array<Record<string, unknown>>;
    };
    expect(stored.items).toEqual([
      { fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', amount: 50 },
      { fromPlayerID: 1, toPlayerID: 3, itemType: 'PEACE_TREATY' },
      { fromPlayerID: 3, toPlayerID: 1, itemType: 'PEACE_TREATY' },
    ]);
    expect(out.deal.items).toHaveLength(3);
  });

  it.each([
    ['absent from the inspection', undefined],
    ['false', false],
  ])('stores exactly the authored terms and inspects once when atWar is %s', async (_label, atWar) => {
    mcp.onTool('inspect-deal', inspectEcho(atWar === undefined ? {} : { atWar }));
    mcp.respondWith('append-message', appendEcho({ ID: 62, Turn: 9 }));

    await appendDealProposal(thread(), 1, 'deal-proposal', goldDeal);

    expect(mcp.calls('inspect-deal')).toHaveLength(1);
    const stored = (mcp.calls('append-message')[0]!.args.Payload as Record<string, unknown>).Deal as {
      items: unknown[];
    };
    expect(stored.items).toEqual(goldDeal.items);
  });
});

describe('appendDealProposal promise legality (stage 7.04)', () => {
  /** An inspected promise verdict for the `COOP_WAR` term the tests author. */
  const inspectedPromise = (over: Record<string, unknown> = {}) => ({
    promiserID: 1, recipientID: 3, promiseType: 'COOP_WAR', targetPlayerID: 9,
    legality: true, reasons: [],
    agreeabilityFactors: { recentDiplomaticEvents: {}, note: '' },
    ...over,
  });
  const coopWarDeal = {
    version: 1 as const,
    items: [],
    promises: [{ promiserID: 1, recipientID: 3, promiseType: 'COOP_WAR' as const, targetPlayerID: 9 }],
  };

  it('archives a promise the inspector reports as legal', async () => {
    mcp.respondWith('inspect-deal', structuredResult({
      items: [], promises: [inspectedPromise()], tradableRange: {},
    }));
    mcp.respondWith('append-message', appendEcho({ ID: 51, Turn: 7 }));

    await expect(appendDealProposal(thread(), 1, 'deal-proposal', coopWarDeal))
      .resolves.toMatchObject({ id: 51 });
    expect(mcp.calls('append-message')).toHaveLength(1);
  });

  it.each([
    ['a duplicate logical commitment', ['This commitment is already part of the deal.']],
    ['an ineligible Coop War target', ['A cooperative war against this civilization is not possible.']],
    ['an already-preparing Coop War', ['A cooperative war against this civilization is already being prepared.']],
    ['a standing promise still in effect', ['This promise is already in effect.']],
    ['a promise with no stated reason', []],
  ])('refuses %s before any archival write', async (_label, reasons) => {
    // Promise legality is BINDING now, exactly like item legality: a schema-valid but already
    // impossible commitment must never become the durable active offer.
    mcp.respondWith('inspect-deal', structuredResult({
      items: [], promises: [inspectedPromise({ legality: false, reasons })], tradableRange: {},
    }));
    mcp.respondWith('append-message', appendEcho({ ID: 52, Turn: 7 }));

    const err = await appendDealProposal(thread(), 1, 'deal-proposal', coopWarDeal).catch((e) => e);

    expect(err).toBeInstanceOf(IllegalDealError);
    expect(err.message).toContain(reasons[0] ?? 'not possible');
    expect(err.details).toEqual([{
      kind: 'promise',
      promiseType: 'COOP_WAR',
      promiserID: 1,
      recipientID: 3,
      targetPlayerID: 9,
      reasons,
    }]);
    // The whole point: an illegal promise writes NO proposal row.
    expect(mcp.calls('append-message')).toHaveLength(0);
  });

  it('names the promise and the civs with friendly labels in the display line', async () => {
    mcp.respondWith('inspect-deal', structuredResult({
      items: [],
      promises: [inspectedPromise({ legality: false, reasons: ['Already at war with that civilization.'] })],
      tradableRange: {},
    }));
    const named = thread({
      player1Identity: { name: 'Rome', leader: 'Augustus' },
      player2Identity: { name: 'Egypt', leader: 'Cleopatra' },
    });

    const err = await appendDealProposal(named, 1, 'deal-proposal', coopWarDeal).catch((e) => e);

    expect(err.message).toContain('(Rome → Egypt)');
    expect(err.message).not.toContain('COOP_WAR');
  });

  it('reports every illegal term at once — items first, then promises', async () => {
    mcp.respondWith('inspect-deal', structuredResult({
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', legality: false, reasons: ['No gold to give'], valueIfIGive: 0, valueIfIReceive: 0 }],
      promises: [inspectedPromise({ legality: false, reasons: ['Already preparing that war.'] })],
      tradableRange: {},
    }));

    const err = await appendDealProposal(thread(), 1, 'deal-proposal', {
      ...coopWarDeal,
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD' as const, amount: 50 }],
    }).catch((e) => e);

    expect(err.reasons).toHaveLength(2);
    expect(err.details.map((d: { kind: string }) => d.kind)).toEqual(['item', 'promise']);
    expect(mcp.calls('append-message')).toHaveLength(0);
  });
});

describe('appendDealReject', () => {
  /** The durable deal-reject row `reject-agent-deal` returns for either successful outcome. */
  const rejectRow = (over: Partial<TranscriptMessage> = {}) => transcriptRow({
    ID: 9, MessageType: 'deal-reject', Content: 'No thanks',
    Payload: { ProposalMessageID: 7 }, Turn: 6, ...over,
  });

  it('rejects through the transactional action, never through append-message', async () => {
    // `append-message` refuses deal-reject now (a pinned writer-split), so the rejection must go
    // through the transactional route that owns proposal state.
    mcp.respondWith('reject-agent-deal', structuredResult({
      Result: 'rejected', ProposalMessageID: 7, AlreadyRejected: false, Row: rejectRow(),
    }));

    const out = await appendDealReject(thread(), 1, 'No thanks', 7);

    expect(out).toEqual({ id: 9, turn: 6, row: rejectRow(), created: true });
    expect(mcp.calls('append-message')).toHaveLength(0);
    expect(mcp.calls('reject-agent-deal')[0]!.args).toEqual({
      PlayerAID: 1, PlayerBID: 3, ProposalMessageID: 7, SpeakerID: 1, Content: 'No thanks',
    });
  });

  it('returns the existing row without a second write when the same speaker repeats it', async () => {
    mcp.respondWith('reject-agent-deal', structuredResult({
      Result: 'already-rejected', ProposalMessageID: 7, AlreadyRejected: true, Row: rejectRow(),
    }));

    const out = await appendDealReject(thread(), 1, 'No thanks', 7);

    // The row still comes back (the client's pending action must resolve), but `created` marks it as
    // an acknowledgement rather than a state transition.
    expect(out.row).toEqual(rejectRow());
    expect(out.created).toBe(false);
  });

  it('records the row only when THIS call created it', async () => {
    const t = thread();
    const fresh = beginTurnState(t);
    mcp.respondWith('reject-agent-deal', structuredResult({
      Result: 'rejected', ProposalMessageID: 7, AlreadyRejected: false, Row: rejectRow(),
    }));
    await appendDealReject(t, 1, 'No thanks', 7);
    expect(fresh.freeze().map((r) => r.ID)).toEqual([9]);

    const repeat = beginTurnState(t);
    mcp.respondWith('reject-agent-deal', structuredResult({
      Result: 'already-rejected', ProposalMessageID: 7, AlreadyRejected: true, Row: rejectRow(),
    }));
    await appendDealReject(t, 1, 'No thanks', 7);
    expect(repeat.freeze()).toEqual([]);
  });

  it.each([
    ['not-found', 'Proposal message 7 does not exist'],
    ['not-a-proposal', 'Message 7 is not a deal-proposal or deal-counter'],
    ['superseded', 'Proposal message 7 is not the current active proposal'],
    ['rejected-by-other', 'Proposal message 7 was already rejected by endpoint 3'],
    ['answered', 'Proposal message 7 is not open; it was answered by deal-accept'],
  ])('translates the structured %s conflict into ProposalConflictError', async (reason, message) => {
    // Mapped from the machine-readable ConflictReason — never by parsing error text.
    mcp.respondWith('reject-agent-deal', structuredResult({
      Result: 'conflict', ProposalMessageID: 7, AlreadyRejected: false,
      ConflictReason: reason, ConflictMessage: message,
    }));

    const err = await appendDealReject(thread(), 1, 'No thanks', 7).catch((e) => e);
    expect(err).toBeInstanceOf(ProposalConflictError);
    expect(err.message).toBe(message);
  });

  it('throws when the action reports success without the committed row', async () => {
    mcp.respondWith('reject-agent-deal', structuredResult({
      Result: 'rejected', ProposalMessageID: 7, AlreadyRejected: false,
    }));
    await expect(appendDealReject(thread(), 1, 'No thanks', 7))
      .rejects.toThrow('did not return the committed deal-reject row');
  });
});

describe('requireCurrentOpenProposal', () => {
  /** A stored open proposal authored by `speaker` for the ordered pair 1↔3. */
  const openProposal = (speaker: number) => structuredResult({
    messages: [transcriptRow({
      ID: 7, SpeakerID: speaker, MessageType: 'deal-proposal', Content: 'Offer',
      Payload: { Deal: emptyDeal }, Turn: 4,
    })],
  });

  it('resolves the open proposal authored by the counterpart', async () => {
    mcp.respondWith('read-transcript', openProposal(3));
    await expect(requireCurrentOpenProposal(thread(), 7, 1)).resolves.toMatchObject({ deal: emptyDeal });
  });

  it.each([
    ['a proposal that is no longer active', 9, 1, /no longer the active proposal/i],
    ['a self-authored proposal (accept)', 7, 3, /cannot respond to its own proposal/i],
  ])('throws ProposalConflictError for %s', async (_label, id, responder, pattern) => {
    mcp.respondWith('read-transcript', openProposal(3));
    const err = await requireCurrentOpenProposal(thread(), id, responder).catch((e) => e);
    expect(err).toBeInstanceOf(ProposalConflictError);
    expect(err.message).toMatch(pattern);
  });

  it('permits the proposal author to act on it when self-authoring is allowed (retraction)', async () => {
    // Rejecting your own open offer IS retracting it, and the store's rule is that either endpoint
    // may speak deal-reject. Only accept refuses a self-authored proposal.
    mcp.respondWith('read-transcript', openProposal(3));
    await expect(requireCurrentOpenProposal(thread(), 7, 3, { allowSelfAuthored: true }))
      .resolves.toMatchObject({ deal: emptyDeal });
  });

  it('throws ProposalConflictError (not a bare Error) for malformed stored terms', async () => {
    mcp.respondWith('read-transcript', structuredResult({
      messages: [transcriptRow({
        ID: 7, SpeakerID: 3, MessageType: 'deal-proposal', Content: 'Offer',
        Payload: { Deal: { nonsense: true } }, Turn: 4,
      })],
    }));
    await expect(requireCurrentOpenProposal(thread(), 7, 1)).rejects.toBeInstanceOf(ProposalConflictError);
  });
});

describe('classifyDealSubmission', () => {
  /** A stored proposal row authored by the agent (seat 3) for the ordered pair 1↔3. */
  const proposalRow = (over: Partial<TranscriptMessage> = {}) => transcriptRow({
    ID: 7, SpeakerID: 3, MessageType: 'deal-proposal', Content: 'Offer',
    Payload: { Deal: emptyDeal }, Turn: 4, ...over,
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
    const rejectRow = transcriptRow({
      ID: 8, MessageType: 'deal-reject', Payload: { ProposalMessageID: 7 }, Turn: 4, CreatedAt: 1,
    });
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
