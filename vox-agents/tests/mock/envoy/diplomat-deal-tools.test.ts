/**
 * Tests for the diplomat's deal views (src/envoy/utils/diplomat-utils.ts): the "deal on the table"
 * block (`formatDealContext`, terms + the negotiator's rationale/message + per-item value snapshots +
 * status, pure over a reduction) AND the inline chat-record renderer (`renderDealRowInline`, which
 * expands each deal transcript row into its conversation line — terms for a proposal, the answered
 * proposal's ID for a reject/accept).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

// Load the agent graph through the registry first (circular-import hazard, see negotiator.test).
import '../../../src/infra/agent-registry.js';
import { formatDealContext, renderDealRowInline } from '../../../src/envoy/utils/diplomat-utils.js';
import { deriveActiveProposal } from '../../../src/utils/diplomacy/deal-reduce.js';
import type { TranscriptMessage } from '../../../src/utils/diplomacy/transcript-utils.js';
import type { EnvoyThread } from '../../../src/types/index.js';

function msg(messageType: TranscriptMessage['MessageType'], payload: Record<string, unknown>, id = 1): TranscriptMessage {
  return {
    ID: id, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
    SpeakerID: 3, MessageType: messageType, Content: '', Payload: payload, Turn: 1, CreatedAt: 0,
  };
}

describe('formatDealContext', () => {
  it('returns undefined when no deal is on the table', () => {
    expect(formatDealContext(deriveActiveProposal([msg('text', {})]), 3)).toBeUndefined();
  });

  it('surfaces own terms, rationale, one-sentence message, advisory estimates from inspection, and status', () => {
    const deal = {
      version: 1 as const,
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD' as const, amount: 50 }],
      promises: [],
      rationale: 'They are desperate for gold.',
      message: 'Fifty gold buys your open borders.',
    };
    const reduction = deriveActiveProposal([msg('deal-counter', { Deal: deal }, 5)]);

    // Advisory values now come from a fresh inspection (index-aligned with deal.items), not stored snapshots.
    const inspection = {
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', legality: true, reasons: [], valueIfIGive: 30, valueIfIReceive: 25 }],
      promises: [],
      tradableRange: {},
    } as any;

    const out = formatDealContext(reduction, 3, undefined, { inspection })!;
    expect(out).toContain('# Deal On The Table (#5, deal-counter, status: open)');
    // Own-authored (SpeakerID 3): private rationale shown, message hoisted as our negotiator's line.
    expect(out).toContain('## Our Negotiator\'s Message');
    expect(out).toContain('They are desperate for gold.');
    expect(out).toContain('Fifty gold buys your open borders.');
    // Direction-grouped, friendly-labelled terms with the advisory per-item estimates.
    expect(out).toContain('## Player 1 Offers To Give Player 3');
    expect(out).toContain('### Gold: 50');
    // Player 1 is the giver here, so its advisory worth reads as a cost (negative).
    expect(out).toContain('Estimated value to Player 1 (them): -30');
    expect(out).toContain('Estimated value to Player 3 (us): 25');
    expect(out).toContain('advisory');
  });

  it('renders a maxed-out advisory estimate as "no usable estimate", never a raw INT_MAX', () => {
    const deal = {
      version: 1 as const,
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD' as const, amount: 50 }],
      promises: [],
    };
    const reduction = deriveActiveProposal([msg('deal-proposal', { Deal: deal }, 8)]);
    const inspection = {
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', legality: true, reasons: [], valueIfIGive: 2147483647, valueIfIReceive: 25 }],
      promises: [],
      tradableRange: {},
    } as any;

    const out = formatDealContext(reduction, 3, undefined, { inspection })!;
    expect(out).not.toContain('2147483647');
    expect(out).toContain('Estimated value to Player 1 (them): no usable estimate');
    expect(out).toContain('Estimated value to Player 3 (us): 25');
  });

  it('renders terms without advisory estimates or the note when no inspection is supplied (closed deal)', () => {
    const deal = {
      version: 1 as const,
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD' as const, amount: 50 }],
      promises: [],
    };
    const accepted = msg('deal-accept', { ProposalMessageID: 5 }, 6);
    const reduction = deriveActiveProposal([msg('deal-proposal', { Deal: deal }, 5), accepted]);

    const out = formatDealContext(reduction, 3)!;
    expect(out).toContain('### Gold: 50');
    expect(out).not.toContain('Estimated value');
    expect(out).not.toContain('advisory');
  });

  it('does not expose the opposing negotiator rationale', () => {
    const deal = {
      version: 1 as const,
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD' as const, amount: 50 }],
      promises: [],
      rationale: 'They will accept because they are weak.',
      message: 'Let us make this trade.',
    };
    const incoming = msg('deal-proposal', { Deal: deal }, 6);
    incoming.SpeakerID = 1;

    const out = formatDealContext(deriveActiveProposal([incoming]), 3)!;

    expect(out).not.toContain('They will accept because they are weak.');
    expect(out).toContain('Let us make this trade.');
  });

  it('closes an open deal with the action ask resolved by author', () => {
    const deal = { version: 1 as const, items: [], promises: [] };

    // Counterpart-authored: the ball is in our court, so the block asks for the negotiator handover.
    const incoming = msg('deal-proposal', { Deal: deal }, 6);
    incoming.SpeakerID = 1;
    const fromCounterpart = formatDealContext(deriveActiveProposal([incoming]), 3)!;
    expect(fromCounterpart).toContain('Hand it to the negotiator');
    expect(fromCounterpart).toContain('call-negotiator');

    // Own-authored: the ball is with the other side, so the block says to await their reply.
    const own = formatDealContext(deriveActiveProposal([msg('deal-proposal', { Deal: deal }, 7)]), 3)!;
    expect(own).toContain("awaits the counterpart's reply");
    expect(own).not.toContain('call-negotiator');
  });

  it('renders third-party relationship + our-leader intention for a coop-war promise, not the agreeability blob', () => {
    const deal = {
      version: 1 as const,
      items: [],
      promises: [{ promiserID: 3, recipientID: 1, promiseType: 'COOP_WAR' as const, targetPlayerID: 9 }],
      message: 'Join me against Rome.',
    };
    const reduction = deriveActiveProposal([msg('deal-counter', { Deal: deal }, 7)]);
    // The inspection still carries the old agreeability factors, but they must NOT be rendered anymore.
    const inspection = {
      items: [],
      promises: [{
        promiserID: 3, recipientID: 1, promiseType: 'COOP_WAR', targetPlayerID: 9,
        agreeabilityFactors: { promiserOpinionOfRecipient: ['FRIENDLY'], note: 'Promise context note' },
      }],
      promiseTargets: [{ playerID: 9, teamID: 9, name: 'Rome', kind: 'major', coopWarEligible: true }],
      tradableRange: {},
    } as any;
    // get-players rows (viewer-perspective) carry each side's public relationship to the third party.
    const players = {
      '3': { Relationships: { Rome: 'War' } },
      '1': { Relationships: { Rome: ['Denounced them'] } },
    } as any;
    // Our leader's own set-relationship directive toward the third party (from get-options).
    const relationships = { Rome: { Public: -50, Private: -30, Rationale: 'Keep Rome weak.', UpdatedTurn: 4 } } as any;
    const civName = (id: number) => (({ 1: 'Egypt', 3: 'Germany' }) as Record<number, string>)[id] ?? `Player ${id}`;

    const out = formatDealContext(reduction, 3, civName, { inspection, players, relationships })!;

    // The two-party agreeability blob (opinions / note / raw factor keys) is gone entirely.
    expect(out).not.toContain('Promise context note');
    expect(out).not.toContain('FRIENDLY');
    expect(out).not.toContain('promiserOpinionOfRecipient');
    // Instead: each side's public relationship to Rome + our leader's directive toward it.
    expect(out).toContain("Germany's (our) relationship to Rome (third-party): War");
    expect(out).toContain("Our leader's intention for Rome: Public -50/Private -30 (Keep Rome weak.)");
    expect(out).toContain("Egypt's (their) relationship to Rome (third-party): Denounced them");
  });
});

describe('renderDealRowInline', () => {
  // Viewer/agent seat is 3 (Germany); the counterpart is seat 1 (Egypt).
  const thread = {
    player1ID: 1, player2ID: 3, agent: 3,
    player1Identity: { name: 'Egypt', leader: 'Cleopatra' },
    player2Identity: { name: 'Germany', leader: 'Bismarck' },
  } as unknown as EnvoyThread;

  const gold50 = {
    version: 1 as const,
    items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD' as const, amount: 50 }],
    promises: [],
  };

  function dealRow(
    messageType: TranscriptMessage['MessageType'],
    payload: Record<string, unknown>,
    over: Partial<Pick<TranscriptMessage, 'ID' | 'SpeakerID' | 'Content'>> = {}
  ): any {
    return {
      ID: over.ID ?? 1, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
      SpeakerID: over.SpeakerID ?? 1, MessageType: messageType, Content: over.Content ?? '',
      Payload: payload, Turn: 1, CreatedAt: 0,
    };
  }

  it('renders a proposal as its message plus direction-grouped, viewer-first, terms-only text', () => {
    const deal = { ...gold50, message: 'Take this gold.' };
    const out = renderDealRowInline(dealRow('deal-proposal', { Deal: deal }, { ID: 6 }), thread)!;
    expect(out).toContain('A deal was proposed (#6): Take this gold.');
    expect(out).toContain('# Egypt gives Germany');
    expect(out).toContain('- Gold: 50');
    // Terms only — advisory per-item values belong to the on-the-table block, not every history line.
    expect(out).not.toContain('worth');
    expect(out).not.toContain('advisory');
  });

  it('labels a counter as such and needs no outward message', () => {
    const out = renderDealRowInline(dealRow('deal-counter', { Deal: gold50 }, { ID: 7 }), thread)!;
    expect(out).toContain('A deal was countered (#7).');
    expect(out).toContain('- Gold: 50');
  });

  it('points the currently-open proposal at the on-the-table block instead of repeating its terms', () => {
    const deal = { ...gold50, message: 'Take this gold.' };
    // openProposalID matches this row → terms are suppressed in favour of the pointer.
    const out = renderDealRowInline(dealRow('deal-proposal', { Deal: deal }, { ID: 6 }), thread, 6)!;
    expect(out).toContain('A deal was proposed (#6): Take this gold.');
    expect(out).toContain('Deal On The Table');
    expect(out).not.toContain('# Egypt gives Germany');
    expect(out).not.toContain('- Gold: 50');
  });

  it('still renders full terms for a superseded proposal when another deal is open', () => {
    // A different proposal (#9) is open, so #6 is history → its terms render inline as usual.
    const out = renderDealRowInline(dealRow('deal-proposal', { Deal: gold50 }, { ID: 6 }), thread, 9)!;
    expect(out).toContain('- Gold: 50');
    expect(out).not.toContain('Deal On The Table');
  });

  it('names the answered proposal on a rejection so a bare decline reads as which deal it settled', () => {
    const out = renderDealRowInline(
      dealRow('deal-reject', { ProposalMessageID: 6 }, { SpeakerID: 3, Content: 'We will not accept this proposal.' }),
      thread
    );
    expect(out).toBe('Rejected deal #6 — We will not accept this proposal.');
  });

  it('references the answered proposal on an acceptance', () => {
    const out = renderDealRowInline(dealRow('deal-accept', { ProposalMessageID: 6 }, { Content: 'Agreed.' }), thread);
    expect(out).toBe('Accepted deal #6 — Agreed.');
  });
});
