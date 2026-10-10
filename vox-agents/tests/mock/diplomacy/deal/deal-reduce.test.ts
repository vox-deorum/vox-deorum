/**
 * Tests for the server-side deal-state reducer (src/utils/diplomacy/deal-reduce.ts), the
 * backend twin of the stage-4 UI reducer. Pure over TranscriptMessage[] — no MCP / game.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveActiveProposal,
  deriveProposalOutcomes,
  activeProposalDeal,
  isAgreed,
} from '../../../../src/utils/diplomacy/deal/deal-reduce.js';
import type { TranscriptMessage } from '../../../../src/utils/diplomacy/transcript/transcript-utils.js';
import { transcriptRow } from '../../../helpers/diplomacy-fixtures.js';

let nextId = 1;
function msg(messageType: TranscriptMessage['MessageType'], payload: Record<string, unknown> = {}, partial: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return transcriptRow({ ID: nextId++, MessageType: messageType, Payload: payload, ...partial });
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

  it('keeps a proposal accepted despite a later reject (acceptance is sticky)', () => {
    const proposal = msg('deal-proposal', { Deal: deal });
    const accept = msg('deal-accept', { ProposalMessageID: proposal.ID }, { SpeakerID: 3 });
    const reject = msg('deal-reject', { ProposalMessageID: proposal.ID }, { SpeakerID: 3 });
    // The `status === "open"` guard prevents the later reject from demoting the accepted deal.
    expect(deriveActiveProposal([proposal, accept, reject]).status).toBe('accepted');
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

describe('deriveProposalOutcomes', () => {
  it('is empty when there are no proposals', () => {
    expect(deriveProposalOutcomes([msg('text'), msg('close')]).size).toBe(0);
  });

  it('reports the only proposal as open and not superseded', () => {
    const proposal = msg('deal-proposal', { Deal: deal });
    const outcome = deriveProposalOutcomes([proposal]).get(proposal.ID);
    expect(outcome).toMatchObject({ status: 'open', superseded: false });
    expect(outcome?.responses).toHaveLength(0);
  });

  it('keeps a rejected proposal rejected after a new proposal supersedes it', () => {
    const first = msg('deal-proposal', { Deal: deal });
    const reject = msg('deal-reject', { ProposalMessageID: first.ID }, { SpeakerID: 3 });
    const second = msg('deal-proposal', { Deal: deal });
    const outcomes = deriveProposalOutcomes([first, reject, second]);
    expect(outcomes.get(first.ID)).toMatchObject({ status: 'rejected', superseded: true });
    expect(outcomes.get(second.ID)).toMatchObject({ status: 'open', superseded: false });
  });

  it('keeps an enacted proposal enacted after a new proposal supersedes it', () => {
    // The reported bug: reading status off the active reduction demoted this card to "superseded",
    // so the acceptance survived only in the standalone outcome rows.
    const first = msg('deal-proposal', { Deal: deal });
    const accept = msg('deal-accept', { ProposalMessageID: first.ID }, { SpeakerID: 3 });
    const enacted = msg('deal-enacted', { ProposalMessageID: first.ID }, { SpeakerID: 3 });
    const second = msg('deal-counter', { Deal: deal });
    const outcomes = deriveProposalOutcomes([first, accept, enacted, second]);
    expect(outcomes.get(first.ID)).toMatchObject({ status: 'enacted', superseded: true });
    expect(outcomes.get(first.ID)?.responses.map((r) => r.ID)).toEqual([accept.ID, enacted.ID]);
  });

  it('leaves an unanswered superseded proposal open, so callers can render it as expired', () => {
    const first = msg('deal-proposal', { Deal: deal });
    const second = msg('deal-counter', { Deal: deal });
    expect(deriveProposalOutcomes([first, second]).get(first.ID)).toMatchObject({
      status: 'open',
      superseded: true,
    });
  });

  it('keeps acceptance sticky against a later reject of the same proposal', () => {
    const proposal = msg('deal-proposal', { Deal: deal });
    const accept = msg('deal-accept', { ProposalMessageID: proposal.ID }, { SpeakerID: 3 });
    const reject = msg('deal-reject', { ProposalMessageID: proposal.ID }, { SpeakerID: 3 });
    expect(deriveProposalOutcomes([proposal, accept, reject]).get(proposal.ID)?.status).toBe('accepted');
  });

  it('does not let a reject demote an enacted proposal', () => {
    const proposal = msg('deal-proposal', { Deal: deal });
    const enacted = msg('deal-enacted', { ProposalMessageID: proposal.ID }, { SpeakerID: 3 });
    const reject = msg('deal-reject', { ProposalMessageID: proposal.ID }, { SpeakerID: 3 });
    expect(deriveProposalOutcomes([proposal, enacted, reject]).get(proposal.ID)?.status).toBe('enacted');
  });

  it('routes each response to the proposal it answers', () => {
    const first = msg('deal-proposal', { Deal: deal });
    const second = msg('deal-counter', { Deal: deal });
    const rejectFirst = msg('deal-reject', { ProposalMessageID: first.ID }, { SpeakerID: 3 });
    const acceptSecond = msg('deal-accept', { ProposalMessageID: second.ID }, { SpeakerID: 3 });
    const outcomes = deriveProposalOutcomes([first, second, rejectFirst, acceptSecond]);
    expect(outcomes.get(first.ID)?.status).toBe('rejected');
    expect(outcomes.get(second.ID)?.status).toBe('accepted');
    expect(outcomes.get(first.ID)?.responses.map((r) => r.ID)).toEqual([rejectFirst.ID]);
  });

  it('ignores responses pointing at an unknown proposal', () => {
    const proposal = msg('deal-proposal', { Deal: deal });
    const orphan = msg('deal-reject', { ProposalMessageID: 9999 }, { SpeakerID: 3 });
    const outcomes = deriveProposalOutcomes([proposal, orphan]);
    expect(outcomes.size).toBe(1);
    expect(outcomes.get(proposal.ID)?.status).toBe('open');
  });
});
