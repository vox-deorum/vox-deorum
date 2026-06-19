/**
 * Tests for the stage-5 enactment-route wrapper and active-proposal reader in
 * src/utils/diplomacy/deal.ts (enactAgentDeal / readActiveProposal). Uses the shared
 * mcpClient fixture — no live MCP server / game.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockMcpClient, structuredResult } from '../../helpers/mock-mcp-client.js';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { enactAgentDeal, readActiveProposal } from '../../../src/utils/diplomacy/deal.js';

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
});

describe('enactAgentDeal', () => {
  it('passes the proposal id and parses the enactment record', async () => {
    mcp.respondWith('enact-agent-deal', structuredResult({
      ProposalMessageID: 7,
      AcceptMessageID: 8,
      EnactedMessageID: 9,
      AlreadyEnacted: false,
      Enacted: false,
      Turn: 4,
    }));

    const out = await enactAgentDeal(7);
    expect(out).toEqual({
      proposalMessageID: 7,
      acceptMessageID: 8,
      enactedMessageID: 9,
      alreadyEnacted: false,
      enacted: false,
      turn: 4,
    });
    expect(mcp.calls('enact-agent-deal')[0]!.args).toEqual({ ProposalMessageID: 7 });
  });

  it('forwards the optional accepter and content', async () => {
    mcp.respondWith('enact-agent-deal', structuredResult({ EnactedMessageID: 9, AlreadyEnacted: false, Enacted: false }));
    await enactAgentDeal(7, { accepterID: 3, content: 'Agreed.' });
    expect(mcp.calls('enact-agent-deal')[0]!.args).toEqual({ ProposalMessageID: 7, AccepterID: 3, Content: 'Agreed.' });
  });

  it('reports a prior enactment as idempotent (no accept id)', async () => {
    mcp.respondWith('enact-agent-deal', structuredResult({ EnactedMessageID: 9, AlreadyEnacted: true, Enacted: false, Turn: 2 }));
    const out = await enactAgentDeal(7);
    expect(out.alreadyEnacted).toBe(true);
    expect(out.acceptMessageID).toBeUndefined();
  });

  it('throws when the route returns no numeric EnactedMessageID', async () => {
    mcp.respondWith('enact-agent-deal', structuredResult({ AlreadyEnacted: false }));
    await expect(enactAgentDeal(7)).rejects.toThrow('numeric EnactedMessageID');
  });
});

describe('readActiveProposal', () => {
  it('reads the transcript and reduces to the latest active proposal', async () => {
    mcp.respondWith('read-transcript', structuredResult({ messages: [
      { ID: 1, MessageType: 'text', Payload: {} },
      { ID: 2, MessageType: 'deal-proposal', Payload: { Deal: { version: 1, items: [], promises: [] } } },
      { ID: 3, MessageType: 'deal-counter', Payload: { Deal: { version: 1, items: [], promises: [] } } },
    ] }));
    const r = await readActiveProposal(1, 3);
    expect(r.active?.ID).toBe(3);
    expect(r.status).toBe('open');
    expect(r.proposals).toHaveLength(2);
  });
});
