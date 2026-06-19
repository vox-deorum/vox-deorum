/**
 * Tests for the diplomat's deal-context view (src/envoy/diplomat-deal-tools.ts): the
 * formatted "deal on the table" block the diplomat sees at every step (terms, the
 * negotiator's rationale/message, per-item value snapshots, status). Pure over a reduction.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

// Load the agent graph through the registry first (circular-import hazard, see negotiator.test).
import '../../../src/infra/agent-registry.js';
import { formatDealContext } from '../../../src/envoy/diplomat-deal-tools.js';
import { deriveActiveProposal } from '../../../src/utils/diplomacy/deal-reduce.js';
import type { TranscriptMessage } from '../../../src/utils/diplomacy/transcript-utils.js';

function msg(messageType: string, payload: Record<string, unknown>, id = 1): TranscriptMessage {
  return {
    ID: id, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
    SpeakerID: 3, MessageType: messageType, Content: '', Payload: payload, Turn: 1, CreatedAt: 0,
  };
}

describe('formatDealContext', () => {
  it('returns undefined when no deal is on the table', () => {
    expect(formatDealContext(deriveActiveProposal([msg('text', {})]), 3)).toBeUndefined();
  });

  it('surfaces own terms, rationale, one-sentence line, value snapshots, and status', () => {
    const deal = {
      version: 1 as const,
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD' as const, amount: 50 }],
      promises: [],
      rationale: 'They are desperate for gold.',
      message: 'Fifty gold buys your open borders.',
    };
    const reduction = deriveActiveProposal([
      msg('deal-counter', { Deal: deal, Value1: { '0': 30 }, Value2: { '0': 25 } }, 5),
    ]);

    const out = formatDealContext(reduction, 3)!;
    expect(out).toContain('deal-counter, message #5, status: open');
    expect(out).toContain('They are desperate for gold.');
    expect(out).toContain('Fifty gold buys your open borders.');
    expect(out).toContain('item[0]=30');
    expect(out).toContain('item[0]=25');
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

  it('surfaces promise agreeability estimates when present', () => {
    const deal = {
      version: 1 as const,
      items: [],
      promises: [{ promiserID: 3, recipientID: 1, promiseType: 'SPY' as const }],
      message: 'We will stop spying if this settles the matter.',
    };
    const reduction = deriveActiveProposal([
      msg('deal-counter', { Deal: deal }, 7),
    ]);

    const out = formatDealContext(reduction, 3, {
      items: [],
      promises: [{
        promiserID: 3,
        recipientID: 1,
        promiseType: 'SPY',
        agreeabilityFactors: {
          promiserOpinionOfRecipient: ['FRIENDLY'],
          note: 'Promise context note',
        },
      }],
      tradableRange: {},
    })!;

    expect(out).toContain('Promise agreeability estimates');
    expect(out).toContain('Promise context note');
    expect(out).toContain('FRIENDLY');
  });
});
