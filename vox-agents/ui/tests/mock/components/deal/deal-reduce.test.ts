import { describe, it, expect } from 'vitest';
import { deriveActiveProposal } from '@/components/deal/deal-reduce';
import type { DealTranscriptMessage } from '@/utils/types';

let nextId = 1;
function msg(messageType: string, payload: Record<string, unknown> = {}): DealTranscriptMessage {
  const id = nextId++;
  return {
    ID: id,
    Player1ID: 0,
    Player2ID: 1,
    Player1Role: 'the leader',
    Player2Role: 'diplomat',
    SpeakerID: 0,
    MessageType: messageType,
    Content: '',
    Payload: payload as DealTranscriptMessage['Payload'],
    Turn: 1,
    CreatedAt: id,
  };
}

const emptyDeal = { version: 1 as const, items: [], promises: [] };

describe('deriveActiveProposal', () => {
  it('returns none for an empty conversation', () => {
    const r = deriveActiveProposal([]);
    expect(r.active).toBeNull();
    expect(r.status).toBe('none');
    expect(r.proposals).toEqual([]);
  });

  it('treats the only proposal as the open active deal', () => {
    const p = msg('deal-proposal', { Deal: emptyDeal });
    const r = deriveActiveProposal([p]);
    expect(r.active).toBe(p);
    expect(r.status).toBe('open');
    expect(r.proposals).toHaveLength(1);
  });

  it('the latest counter supersedes earlier proposals', () => {
    const p = msg('deal-proposal', { Deal: emptyDeal });
    const c = msg('deal-counter', { Deal: emptyDeal });
    const r = deriveActiveProposal([p, c]);
    expect(r.active).toBe(c);
    expect(r.status).toBe('open');
    expect(r.proposals).toHaveLength(2);
  });

  it('marks the active proposal rejected when a reject references it', () => {
    const p = msg('deal-proposal', { Deal: emptyDeal });
    const reject = msg('deal-reject', { ProposalMessageID: p.ID });
    const r = deriveActiveProposal([p, reject]);
    expect(r.active).toBe(p);
    expect(r.status).toBe('rejected');
  });

  it('ignores a reject that references a superseded earlier proposal', () => {
    const p = msg('deal-proposal', { Deal: emptyDeal });
    const reject = msg('deal-reject', { ProposalMessageID: p.ID });
    const c = msg('deal-counter', { Deal: emptyDeal });
    // The reject answers the old proposal; the newer counter is open.
    const r = deriveActiveProposal([p, reject, c]);
    expect(r.active).toBe(c);
    expect(r.status).toBe('open');
  });

  it('enacted wins over accept for the same proposal (forward-compatible with stage 6)', () => {
    const p = msg('deal-proposal', { Deal: emptyDeal });
    const accept = msg('deal-accept', { ProposalMessageID: p.ID });
    const enacted = msg('deal-enacted', { ProposalMessageID: p.ID });
    const r = deriveActiveProposal([p, accept, enacted]);
    expect(r.active).toBe(p);
    expect(r.status).toBe('enacted');
  });
});
