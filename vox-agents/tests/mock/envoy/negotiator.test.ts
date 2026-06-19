/**
 * Tests for the negotiator agent (src/envoy/negotiator.ts): its three terminal tools, the
 * `call-negotiator` handoff input mapping (resolveHandoffInput), the transcript-driven task
 * determination + upfront inspect in getInitialMessages, and the diplomat-facing summary in
 * getOutput. The terminal tools read the live NegotiatorInput from context.currentInput, persist
 * their move through the durable store, and record the move on input.outcome. Uses the shared
 * mcpClient fixture — no live game / LLM.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installMockMcpClient, structuredResult } from '../../helpers/mock-mcp-client.js';
import type { EnvoyThread } from '../../../src/types/index.js';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

// Load the full agent graph through the registry (the canonical load entry) BEFORE importing
// an agent module in isolation — otherwise vox-agent → vox-context → agent-registry → strategist
// re-enters vox-agent mid-evaluation (the circular-import hazard noted in diplomat-prompts.test).
import '../../../src/infra/agent-registry.js';
import {
  createNegotiatorTerminalTools,
  Negotiator,
  type NegotiatorInput,
} from '../../../src/envoy/negotiator.js';
import { sessionRegistry } from '../../../src/infra/session-registry.js';

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
  mcp.respondWith('read-transcript', structuredResult([]));
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Diplomacy thread: ordered pair 1↔3, negotiator voices seat 3. */
function thread(partial: Partial<EnvoyThread> = {}): EnvoyThread {
  return {
    id: 'dipl:g:1:3',
    agent: 3,
    gameID: 'g',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'negotiator',
    diplomacy: true,
    contextType: 'live',
    contextId: 'g-player-3',
    messages: [],
    ...partial,
  };
}

const emptyInspection = { items: [], promises: [], tradableRange: {} };

/** A live NegotiatorInput, with or without an on-the-table proposal. */
function negotiatorInput(partial: Partial<NegotiatorInput> = {}): NegotiatorInput {
  return {
    thread: thread(),
    briefing: 'They want peace.',
    ...partial,
  };
}

/** Minimal context stub: the tools read currentInput + lastParameter. */
function makeContext(input: NegotiatorInput) {
  return { id: 'ctx', currentInput: input, lastParameter: { turn: 5, playerID: 3 } } as any;
}

/** Invoke a terminal tool's execute with the standard tool-call options. */
function run(tool: any, args: Record<string, unknown>) {
  return tool.execute(args, { toolCallId: 't', messages: [] });
}

/** Configure the durable transcript with one open proposal. */
function setOpenProposal(
  id = 7,
  speakerID = 1,
  deal = { version: 1 as const, items: [], promises: [] }
) {
  mcp.respondWith('read-transcript', structuredResult([
    {
      ID: id,
      Player1ID: 1,
      Player2ID: 3,
      Player1Role: 'the leader',
      Player2Role: 'negotiator',
      SpeakerID: speakerID,
      MessageType: 'deal-proposal',
      Content: 'Offer',
      Payload: { Deal: deal },
      Turn: 5,
      CreatedAt: 0,
    },
  ]));
}

describe('accept-deal', () => {
  it('routes through enact-agent-deal and records an accept outcome', async () => {
    setOpenProposal();
    mcp.respondWith('enact-agent-deal', structuredResult({ EnactedMessageID: 9, AcceptMessageID: 8, AlreadyEnacted: false, Enacted: false, Turn: 4 }));
    const input = negotiatorInput({ activeProposal: { messageID: 7, deal: { version: 1, items: [], promises: [] } } });
    const tools = createNegotiatorTerminalTools(makeContext(input));

    const msg = await run(tools['accept-deal'], { rationale: 'Good enough.' });

    expect(input.outcome).toMatchObject({ type: 'accept', proposalMessageID: 7, rationale: 'Good enough.' });
    // The accepter is the negotiator's own seat (the LLM accepting the relayed deal).
    expect(mcp.calls('enact-agent-deal')[0]!.args).toMatchObject({ ProposalMessageID: 7, AccepterID: 3 });
    expect(msg).toContain('Accepted proposal #7');
  });

  it('refuses to accept when no deal is on the table', async () => {
    const input = negotiatorInput();
    const tools = createNegotiatorTerminalTools(makeContext(input));
    const msg = await run(tools['accept-deal'], { rationale: 'x' });
    expect(msg).toContain('no deal on the table');
    expect(input.outcome).toBeUndefined();
    expect(mcp.calls('enact-agent-deal')).toHaveLength(0);
  });

  it('rechecks the active proposal before accepting', async () => {
    setOpenProposal(8);
    const input = negotiatorInput({ activeProposal: { messageID: 7, deal: { version: 1, items: [], promises: [] } } });
    const tools = createNegotiatorTerminalTools(makeContext(input));

    const msg = await run(tools['accept-deal'], { rationale: 'Good enough.' });

    expect(msg).toContain('no longer the active proposal');
    expect(input.outcome).toBeUndefined();
    expect(mcp.calls('enact-agent-deal')).toHaveLength(0);
  });
});

describe('propose-counter-deal', () => {
  it('writes a deal-proposal (opening) when nothing is on the table', async () => {
    mcp.respondWith('inspect-deal', structuredResult(emptyInspection));
    mcp.respondWith('append-message', structuredResult({ ID: 11, Turn: 5 }));
    const input = negotiatorInput({ intent: 'open trade' });
    const tools = createNegotiatorTerminalTools(makeContext(input));

    await run(tools['propose-counter-deal'], {
      rationale: 'Start modest.',
      message: 'I offer 50 gold for your map.',
      items: [{ fromPlayerID: 3, toPlayerID: 1, itemType: 'GOLD', amount: 50 }],
      promises: [],
    });

    const append = mcp.calls('append-message')[0]!.args;
    expect(append.MessageType).toBe('deal-proposal');
    expect(append.SpeakerID).toBe(3); // the negotiator's seat authors it
    const payloadDeal = (append.Payload as any).Deal;
    expect(payloadDeal.rationale).toBe('Start modest.');
    expect(payloadDeal.message).toBe('I offer 50 gold for your map.');
    expect(input.outcome).toMatchObject({
      type: 'propose',
      dealMessageID: 11,
      deal: payloadDeal,
      inspection: emptyInspection,
    });
  });

  it('writes a deal-counter when a deal is on the table', async () => {
    setOpenProposal();
    mcp.respondWith('inspect-deal', structuredResult(emptyInspection));
    mcp.respondWith('append-message', structuredResult({ ID: 12, Turn: 5 }));
    const input = negotiatorInput({ activeProposal: { messageID: 7, deal: { version: 1, items: [], promises: [] } } });
    const tools = createNegotiatorTerminalTools(makeContext(input));

    await run(tools['propose-counter-deal'], {
      rationale: 'Ask for more.',
      message: 'Add open borders and we have a deal.',
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'OPEN_BORDERS' }],
      promises: [],
    });

    expect(mcp.calls('append-message')[0]!.args.MessageType).toBe('deal-counter');
    expect(input.outcome).toMatchObject({ type: 'counter', dealMessageID: 12 });
  });

  it('refuses an empty proposal (no terms)', async () => {
    const input = negotiatorInput();
    const tools = createNegotiatorTerminalTools(makeContext(input));
    const msg = await run(tools['propose-counter-deal'], { rationale: 'x', message: 'y', items: [], promises: [] });
    expect(msg).toContain('at least one trade item or promise');
    expect(input.outcome).toBeUndefined();
    expect(mcp.calls('append-message')).toHaveLength(0);
  });

  it('does not create an opening proposal while another proposal is open', async () => {
    setOpenProposal();
    const input = negotiatorInput({ intent: 'open trade' });
    const tools = createNegotiatorTerminalTools(makeContext(input));

    const msg = await run(tools['propose-counter-deal'], {
      rationale: 'Start modest.',
      message: 'I offer 50 gold.',
      items: [{ fromPlayerID: 3, toPlayerID: 1, itemType: 'GOLD', amount: 50 }],
      promises: [],
    });

    expect(msg).toContain('already open');
    expect(input.outcome).toBeUndefined();
    expect(mcp.calls('append-message')).toHaveLength(0);
  });
});

describe('reject-deal', () => {
  it('appends a deal-reject referencing the on-the-table proposal', async () => {
    setOpenProposal();
    mcp.respondWith('append-message', structuredResult({ ID: 13, Turn: 5 }));
    const input = negotiatorInput({ activeProposal: { messageID: 7, deal: { version: 1, items: [], promises: [] } } });
    const tools = createNegotiatorTerminalTools(makeContext(input));

    await run(tools['reject-deal'], { rationale: 'Insulting offer.' });

    const append = mcp.calls('append-message')[0]!.args;
    expect(append.MessageType).toBe('deal-reject');
    expect((append.Payload as any).ProposalMessageID).toBe(7);
    expect(input.outcome).toMatchObject({ type: 'reject', proposalMessageID: 7, rejectMessageID: 13 });
  });

  it('refuses to reject when no deal is on the table', async () => {
    const input = negotiatorInput();
    const tools = createNegotiatorTerminalTools(makeContext(input));
    const msg = await run(tools['reject-deal'], { rationale: 'x' });
    expect(msg).toContain('no deal on the table');
    expect(mcp.calls('append-message')).toHaveLength(0);
  });
});

describe('negotiator completion', () => {
  it('does not stop on a terminal error string when no outcome was persisted', () => {
    const negotiator = new Negotiator();
    const input = negotiatorInput();
    const failedTerminalStep = {
      toolCalls: [{ toolName: 'accept-deal' }],
      toolResults: [{ toolName: 'accept-deal', output: 'Proposal is stale' }],
    } as any;

    expect(
      negotiator.stopCheck({} as any, input, failedTerminalStep, [failedTerminalStep], {} as any)
    ).toBe(false);
  });

  it('takes only the first terminal tool call from one model step', async () => {
    setOpenProposal();
    mcp.respondWith('enact-agent-deal', structuredResult({
      EnactedMessageID: 9,
      AcceptMessageID: 8,
      AlreadyEnacted: false,
      Enacted: false,
      Turn: 5,
    }));
    const input = negotiatorInput({
      activeProposal: { messageID: 7, deal: { version: 1, items: [], promises: [] } },
    });
    const tools = createNegotiatorTerminalTools(makeContext(input));
    const sharedMessages: unknown[] = [];

    const [accepted, dropped] = await Promise.all([
      tools['accept-deal'].execute!(
        { rationale: 'Accept it.' },
        { toolCallId: 'first', messages: sharedMessages } as any
      ),
      tools['reject-deal'].execute!(
        { rationale: 'Reject it.' },
        { toolCallId: 'second', messages: sharedMessages } as any
      ),
    ]);

    expect(accepted).toContain('Accepted proposal #7');
    expect(dropped).toContain('accept-deal was the first terminal tool call');
    expect(input.outcome).toMatchObject({ type: 'accept', proposalMessageID: 7 });
    expect(mcp.calls('append-message')).toHaveLength(0);
  });
});

describe('resolveHandoffInput', () => {
  it('merges the diplomat handoff args with the ambient conversation thread', () => {
    const negotiator = new Negotiator();
    const t = thread();
    const input = negotiator.resolveHandoffInput(
      { Briefing: 'They want peace.', Intent: 'Open trade.' },
      { currentInput: t } as any
    );
    expect(input).toMatchObject({ thread: t, briefing: 'They want peace.', intent: 'Open trade.' });
  });
});

describe('resolveHandoffTarget', () => {
  const negotiator = new Negotiator();
  const ctx = (t: EnvoyThread) => ({ currentInput: t } as any);

  it('falls back to the built-in negotiator when no session configures one', () => {
    vi.spyOn(sessionRegistry, 'getActive').mockReturnValue(undefined as any);
    expect(negotiator.resolveHandoffTarget(ctx(thread()))).toBe('negotiator');
  });

  it("dispatches to the seat's configured negotiator when it is registered", () => {
    // 'diplomat' is a registered agent — stand-in for a per-seat custom negotiator variant.
    vi.spyOn(sessionRegistry, 'getActive').mockReturnValue({
      getPlayerAssignments: () => ({ 3: { negotiator: 'diplomat' } }),
    } as any);
    expect(negotiator.resolveHandoffTarget(ctx(thread()))).toBe('diplomat');
  });

  it('falls back when the configured negotiator is not registered', () => {
    vi.spyOn(sessionRegistry, 'getActive').mockReturnValue({
      getPlayerAssignments: () => ({ 3: { negotiator: 'no-such-agent' } }),
    } as any);
    expect(negotiator.resolveHandoffTarget(ctx(thread()))).toBe('negotiator');
  });
});

describe('getInitialMessages task determination', () => {
  /** Minimal game state so buildGameContextMessages does not throw. */
  const params = {
    playerID: 3,
    gameID: 'g',
    turn: 5,
    metadata: { YouAre: { Name: 'Germany', Leader: 'Bismarck' } },
    gameStates: { 5: { options: {}, players: {} } },
  } as any;
  const content = (messages: any[]) => messages.map((m) => m.content).join('\n');

  it('forwards a still-open proposal authored by the counterpart (respond task)', async () => {
    setOpenProposal(7, 1); // counterpart (seat 1) authored it; the negotiator voices seat 3
    mcp.respondWith('inspect-deal', structuredResult(emptyInspection));
    const negotiator = new Negotiator();
    const input = negotiatorInput();

    const messages = await negotiator.getInitialMessages(params, input, {} as any);

    expect(input.activeProposal).toMatchObject({ messageID: 7 });
    expect(content(messages)).toContain('deal on the table');
    // Inspection runs against the on-the-table deal.
    expect(mcp.calls('inspect-deal')[0]!.args).toHaveProperty('ProposedDeal');
  });

  it('opens a deal when nothing is on the table (request task)', async () => {
    mcp.respondWith('inspect-deal', structuredResult(emptyInspection));
    const negotiator = new Negotiator();
    const input = negotiatorInput({ intent: 'Improve relations.' });

    const messages = await negotiator.getInitialMessages(params, input, {} as any);

    expect(input.activeProposal).toBeUndefined();
    expect(content(messages)).toContain('no deal from the counterpart');
    expect(mcp.calls('inspect-deal')[0]!.args).not.toHaveProperty('ProposedDeal');
  });

  it('does not forward the seat own pending proposal (notes it awaits a reply)', async () => {
    setOpenProposal(7, 3); // the negotiator's own seat authored it
    mcp.respondWith('inspect-deal', structuredResult(emptyInspection));
    const negotiator = new Negotiator();
    const input = negotiatorInput();

    const messages = await negotiator.getInitialMessages(params, input, {} as any);

    expect(input.activeProposal).toBeUndefined();
    expect(content(messages)).toContain('awaiting the counterpart');
  });
});

describe('getOutput', () => {
  const negotiator = new Negotiator();

  it('summarizes a rejection for the diplomat to voice', async () => {
    const input = negotiatorInput({
      outcome: { type: 'reject', rationale: 'Insulting.', proposalMessageID: 7, rejectMessageID: 9 },
    });
    const out = await negotiator.getOutput({} as any, input, '');
    expect(out).toContain('REJECTED');
    expect(out).toContain('Insulting.');
  });

  it('summarizes a proposal with its terms and estimates', async () => {
    const input = negotiatorInput({
      outcome: {
        type: 'propose',
        rationale: 'A fair opening.',
        message: 'Fifty gold for open borders.',
        dealMessageID: 11,
        deal: { version: 1, items: [{ fromPlayerID: 3, toPlayerID: 1, itemType: 'GOLD', amount: 50 }], promises: [] },
        inspection: emptyInspection,
      },
    });
    const out = await negotiator.getOutput({} as any, input, '');
    expect(out).toContain('PROPOSAL');
    expect(out).toContain('deal message #11');
    expect(out).toContain('itemType: GOLD');
  });

  it('returns undefined when no terminal tool recorded a move', async () => {
    const out = await negotiator.getOutput({} as any, negotiatorInput(), '');
    expect(out).toBeUndefined();
  });
});
