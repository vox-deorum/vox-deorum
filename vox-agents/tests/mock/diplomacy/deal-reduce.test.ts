/**
 * Tests for the server-side deal-state reducer (src/utils/diplomacy/deal-reduce.ts), the
 * backend twin of the stage-4 UI reducer. Pure over TranscriptMessage[] — no MCP / game.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveActiveProposal,
  activeProposalDeal,
  isAgreed,
} from '../../../src/utils/diplomacy/deal-reduce.js';
import type { TranscriptMessage } from '../../../src/utils/diplomacy/transcript-utils.js';

let nextId = 1;
function msg(messageType: string, payload: Record<string, unknown> = {}, partial: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return {
    ID: nextId++,
    Player1ID: 1,
    Player2ID: 3,
    Player1Role: 'the leader',
    Player2Role: 'diplomat',
    SpeakerID: 1,
    MessageType: messageType,
    Content: '',
    Payload: payload,
    Turn: 1,
    CreatedAt: 0,
    ...partial,
  };
}

const deal = { version: 1 as const, items: [], promises: [] };

describe('deriveActiveProposal', () => {
  it('reports none when there are no proposals', () => {
    const r = deriveActiveProposal([msg('text'), msg('close')]);
    expect(r.active).toBeNull();
    expect(r.status).toBe('none');
    expect(r.proposals).toHaveLength(0);
  });

  it('treats a lone proposal as the open active deal', () => {
    const proposal = msg('deal-proposal', { Deal: deal });
    const r = deriveActiveProposal([proposal]);
    expect(r.active?.ID).toBe(proposal.ID);
    expect(r.status).toBe('open');
  });

  it('uses the latest counter as the active proposal', () => {
    const proposal = msg('deal-proposal', { Deal: deal });
    const counter = msg('deal-counter', { Deal: deal });
    const r = deriveActiveProposal([proposal, counter]);
    expect(r.active?.ID).toBe(counter.ID);
    expect(r.proposals).toHaveLength(2);
  });

  it('marks the active proposal accepted when a deal-accept answers it', () => {
    const proposal = msg('deal-proposal', { Deal: deal });
    const accept = msg('deal-accept', { ProposalMessageID: proposal.ID }, { SpeakerID: 3 });
    expect(deriveActiveProposal([proposal, accept]).status).toBe('accepted');
  });

  it('marks the active proposal rejected when only a deal-reject answers it', () => {
    const proposal = msg('deal-proposal', { Deal: deal });
    const reject = msg('deal-reject', { ProposalMessageID: proposal.ID }, { SpeakerID: 3 });
    expect(deriveActiveProposal([proposal, reject]).status).toBe('rejected');
  });

  it('prefers enacted over accepted (enactment is terminal)', () => {
    const proposal = msg('deal-proposal', { Deal: deal });
    const accept = msg('deal-accept', { ProposalMessageID: proposal.ID });
    const enacted = msg('deal-enacted', { ProposalMessageID: proposal.ID });
    expect(deriveActiveProposal([proposal, accept, enacted]).status).toBe('enacted');
  });

  it('ignores responses that answer an earlier (superseded) proposal', () => {
    const proposal = msg('deal-proposal', { Deal: deal });
    const acceptOld = msg('deal-accept', { ProposalMessageID: proposal.ID });
    const counter = msg('deal-counter', { Deal: deal });
    // The accept answers the original proposal, not the live counter → counter stays open.
    const r = deriveActiveProposal([proposal, acceptOld, counter]);
    expect(r.active?.ID).toBe(counter.ID);
    expect(r.status).toBe('open');
  });
});

describe('activeProposalDeal / isAgreed', () => {
  it('returns the active proposal terms', () => {
    const terms = { version: 1 as const, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD' as const, amount: 50 }], promises: [] };
    const r = deriveActiveProposal([msg('deal-proposal', { Deal: terms })]);
    expect(activeProposalDeal(r)).toEqual(terms);
  });

  it('reports agreement for accepted and enacted, not for open/rejected', () => {
    const proposal = msg('deal-proposal', { Deal: deal });
    expect(isAgreed(deriveActiveProposal([proposal]))).toBe(false);
    const accept = msg('deal-accept', { ProposalMessageID: proposal.ID });
    expect(isAgreed(deriveActiveProposal([proposal, accept]))).toBe(true);
  });
});
