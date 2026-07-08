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
import { Negotiator } from '../../../src/envoy/negotiator.js';
import {
  createNegotiatorTerminalTools,
  type NegotiatorInput,
} from '../../../src/envoy/utils/negotiator-utils.js';
import { sessionRegistry } from '../../../src/infra/session-registry.js';
import { createFakeVoxContext } from '../../helpers/fake-vox-context.js';
import { PROMISE_METADATA, AGREEMENT_METADATA } from '../../../../mcp-server/dist/utils/deal-schema.js';

/** The nudge the negotiator inherits from its terminal-tool requiredTools (declared order). */
const NEGOTIATOR_NUDGE =
  'Make sure to call `accept-deal`, `propose-deal`, or `reject-deal` following the EXACT provided format to finalize your decisions.';

/** The canonical label for an agreement item type (from the single-source AGREEMENT_METADATA). */
const agreementLabel = (itemType: string) => AGREEMENT_METADATA.find((a) => a.itemType === itemType)!.label;

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
  mcp.respondWith('read-transcript', structuredResult({ messages: [] }));
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

/**
 * A complete-but-empty tradable side range, matching what `inspect-deal` actually returns for a seat
 * (both seats are always present, every category populated — see inspect-deal.lua). Nothing is legal
 * or available, so the menu renders its header with no rows.
 */
function emptySideRange() {
  return {
    gold: { available: false, max: 0, reasons: [] },
    goldPerTurn: { available: false, reasons: [] },
    resources: [], cities: [], techs: [], thirdPartyPeace: [], thirdPartyWar: [], voteCommitments: [],
    maps: { legal: false, reasons: [] },
    allowEmbassy: { legal: false, reasons: [] },
    openBorders: { legal: false, reasons: [] },
    declarationOfFriendship: { legal: false, reasons: [] },
    defensivePact: { legal: false, reasons: [] },
    researchAgreement: { legal: false, reasons: [] },
    peaceTreaty: { legal: false, reasons: [] },
    vassalage: { legal: false, reasons: [] },
    vassalageRevoke: { legal: false, reasons: [] },
  };
}

const emptyInspection = {
  items: [], promises: [], promiseTargets: [],
  tradableRange: { '1': emptySideRange(), '3': emptySideRange() },
};

/** A side range where every toggle/gold is legal/available — for tests that author an ON-MENU term and
 *  need to reach the code past resolution (the resolver now gates authored terms against the menu). */
function legalSideRange() {
  const r = emptySideRange();
  r.gold = { available: true, max: 500, reasons: [] };
  r.goldPerTurn = { available: true, reasons: [] };
  for (const key of ['maps', 'allowEmbassy', 'openBorders', 'declarationOfFriendship', 'defensivePact', 'researchAgreement', 'peaceTreaty', 'vassalage', 'vassalageRevoke'] as const) {
    (r as any)[key] = { legal: true, reasons: [] };
  }
  return r;
}

const legalInspection = {
  items: [], promises: [], promiseTargets: [],
  tradableRange: { '1': legalSideRange(), '3': legalSideRange() },
};

/** An inspection whose GIVE side (seat 3) holds a named resource, so name resolution can be exercised. */
const namedInspection = {
  items: [],
  promises: [],
  tradableRange: {
    '3': { resources: [{ resourceID: 1, name: 'Iron', category: 'strategic', quantityAvailable: 4, legal: true, reasons: [] }] },
  },
  promiseTargets: [],
} as any;

/** A live NegotiatorInput, with or without an on-the-table proposal. */
function negotiatorInput(partial: Partial<NegotiatorInput> = {}): NegotiatorInput {
  return {
    thread: thread(),
    briefing: 'They want peace.',
    ...partial,
  };
}

/** Minimal context stub: the tools read currentInput + currentParameters. */
function makeContext(input: NegotiatorInput) {
  return { id: 'ctx', currentInput: input, currentParameters: { turn: 5, playerID: 3 } } as any;
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
  mcp.respondWith('read-transcript', structuredResult({ messages: [
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
  ] }));
}

describe('accept-deal', () => {
  it('routes through enact-agent-deal and records an accept outcome', async () => {
    setOpenProposal();
    mcp.respondWith('enact-agent-deal', structuredResult({ EnactedMessageID: 9, AcceptMessageID: 8, AlreadyEnacted: false, Enacted: false, Turn: 4 }));
    const input = negotiatorInput({ activeProposal: { messageID: 7, deal: { version: 1, items: [], promises: [] } } });
    const tools = createNegotiatorTerminalTools(makeContext(input));

    const msg = await run(tools['accept-deal'], { Rationale: 'Good enough.', Message: 'We have an accord.' });

    expect(input.outcome).toMatchObject({ type: 'accept', proposalMessageID: 7, rationale: 'Good enough.', message: 'We have an accord.' });
    // The accepter is the negotiator's own seat (the LLM accepting the relayed deal); the outward
    // Message is recorded as the deal-accept row's Content so the UI surfaces it as the reply.
    expect(mcp.calls('enact-agent-deal')[0]!.args).toMatchObject({ ProposalMessageID: 7, AccepterID: 3, Content: 'We have an accord.' });
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

describe('propose-deal', () => {
  it('resolves a Give term by name/amount into a directed deal-proposal (opening)', async () => {
    mcp.respondWith('inspect-deal', structuredResult(emptyInspection));
    mcp.respondWith('append-message', structuredResult({ ID: 11, Turn: 5 }));
    const input = negotiatorInput({ intent: 'open trade', upfrontInspection: legalInspection });
    const tools = createNegotiatorTerminalTools(makeContext(input));

    await run(tools['propose-deal'], {
      Rationale: 'Start modest.',
      Message: 'I offer 50 gold for your map.',
      Give: [{ Term: 'Gold', Amount: 50 }],
      Take: [],
    });

    const append = mcp.calls('append-message')[0]!.args;
    expect(append.MessageType).toBe('deal-proposal');
    expect(append.SpeakerID).toBe(3); // the negotiator's seat authors it
    const payloadDeal = (append.Payload as any).Deal;
    expect(payloadDeal.rationale).toBe('Start modest.');
    expect(payloadDeal.message).toBe('I offer 50 gold for your map.');
    // A Give runs from the negotiator's own seat (3) to the counterpart (1).
    expect(payloadDeal.items).toEqual([{ fromPlayerID: 3, toPlayerID: 1, itemType: 'GOLD', amount: 50 }]);
    expect(input.outcome).toMatchObject({ type: 'propose', dealMessageID: 11, deal: payloadDeal });
  });

  it('resolves a Take term into a counter directed from the counterpart', async () => {
    setOpenProposal();
    mcp.respondWith('inspect-deal', structuredResult(emptyInspection));
    mcp.respondWith('append-message', structuredResult({ ID: 12, Turn: 5 }));
    const input = negotiatorInput({
      activeProposal: { messageID: 7, deal: { version: 1, items: [], promises: [] } },
      upfrontInspection: legalInspection,
    });
    const tools = createNegotiatorTerminalTools(makeContext(input));

    await run(tools['propose-deal'], {
      Rationale: 'Ask for more.',
      Message: 'Add open borders and we have a deal.',
      Give: [],
      Take: [{ Term: 'Open Borders' }],
    });

    const append = mcp.calls('append-message')[0]!.args;
    expect(append.MessageType).toBe('deal-counter');
    // A Take runs from the counterpart (1) to the negotiator's own seat (3).
    expect((append.Payload as any).Deal.items).toEqual([{ fromPlayerID: 1, toPlayerID: 3, itemType: 'OPEN_BORDERS' }]);
    expect(input.outcome).toMatchObject({ type: 'counter', dealMessageID: 12 });
  });

  it('refuses an empty proposal (no terms)', async () => {
    const input = negotiatorInput();
    const tools = createNegotiatorTerminalTools(makeContext(input));
    const msg = await run(tools['propose-deal'], { Rationale: 'x', Message: 'y', Give: [], Take: [] });
    expect(msg).toContain('at least one term in Give or Take');
    expect(input.outcome).toBeUndefined();
    expect(mcp.calls('append-message')).toHaveLength(0);
  });

  it('returns correctable feedback (with suggestions) for a misspelled name, writing nothing', async () => {
    const input = negotiatorInput({ intent: 'open trade', upfrontInspection: namedInspection });
    const tools = createNegotiatorTerminalTools(makeContext(input));

    const msg = await run(tools['propose-deal'], {
      Rationale: 'Trade iron.',
      Message: 'My iron for your gold.',
      Give: [{ Term: 'Resource', Name: 'Irn' }],
      Take: [],
    });

    expect(msg).toContain('Iron'); // suggested the closest available name
    expect(msg).toContain('[Give]');
    expect(input.outcome).toBeUndefined();
    expect(mcp.calls('append-message')).toHaveLength(0);
  });

  it('reframes an untradeable item as Give/Take feedback, writing nothing', async () => {
    // The fresh inspection inside appendDealProposal reports the gold term as illegal.
    mcp.respondWith('inspect-deal', structuredResult({
      items: [{ fromPlayerID: 3, toPlayerID: 1, itemType: 'GOLD', legality: false, reasons: ['You have no gold.'], valueIfIGive: 0, valueIfIReceive: 0 }],
      promises: [],
      tradableRange: {},
    }));
    const input = negotiatorInput({ intent: 'open trade', upfrontInspection: legalInspection });
    const tools = createNegotiatorTerminalTools(makeContext(input));

    const msg = await run(tools['propose-deal'], {
      Rationale: 'Pay up.',
      Message: 'Here is gold.',
      Give: [{ Term: 'Gold', Amount: 50 }],
      Take: [],
    });

    expect(msg).toContain('[Give] Gold');
    expect(msg).toContain('You have no gold.');
    expect(input.outcome).toBeUndefined();
    expect(mcp.calls('append-message')).toHaveLength(0);
  });

  it('does not create an opening proposal while another proposal is open', async () => {
    setOpenProposal();
    const input = negotiatorInput({ intent: 'open trade', upfrontInspection: legalInspection });
    const tools = createNegotiatorTerminalTools(makeContext(input));

    const msg = await run(tools['propose-deal'], {
      Rationale: 'Start modest.',
      Message: 'I offer 50 gold.',
      Give: [{ Term: 'Gold', Amount: 50 }],
      Take: [],
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

    await run(tools['reject-deal'], { rationale: 'Insulting offer.', Message: 'We must decline this.' });

    const append = mcp.calls('append-message')[0]!.args;
    expect(append.MessageType).toBe('deal-reject');
    // The outward Message is the deal-reject row's Content, rendered on the reject's own standalone card.
    expect(append.Content).toBe('We must decline this.');
    expect((append.Payload as any).ProposalMessageID).toBe(7);
    expect(input.outcome).toMatchObject({ type: 'reject', proposalMessageID: 7, rejectMessageID: 13, message: 'We must decline this.' });
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

  it('nudges toward its terminal tools when a continuation step produced text but no move', async () => {
    // Negotiator runs toolChoice:"auto", so text-without-a-terminal-call is not the empty-response
    // rescue path; the inherited requiredTools nudge is what pushes it to commit. No override needed.
    const negotiator = new Negotiator();
    const ctx = createFakeVoxContext().asContext();
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'Decide on the deal.' },
    ];
    const textStep = { toolCalls: [], text: 'Let me weigh the offer...', response: { messages: [] } } as any;

    const config = await negotiator.prepareStep({} as any, negotiatorInput(), textStep, [textStep], messages, ctx);

    const last = config.messages![config.messages!.length - 1];
    expect(last).toEqual({ role: 'user', content: NEGOTIATOR_NUDGE });
  });

  it('does not re-append the nudge when it is already the last message', async () => {
    const negotiator = new Negotiator();
    const ctx = createFakeVoxContext().asContext();
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'Decide on the deal.' },
      { role: 'user' as const, content: NEGOTIATOR_NUDGE },
    ];
    // A step that called a SUPPORT tool (get-briefing) produced tool calls, so the empty-response
    // rescue is skipped and only the continuation-nudge dedup runs. (A text-only step under the
    // required tool-choice would instead trip the rescue, which is its own path.) The nudge is already
    // the last message, so it must not be appended again.
    const supportStep = { toolCalls: [{ toolName: 'get-briefing' }], text: '', response: { messages: [] } } as any;

    const config = await negotiator.prepareStep({} as any, negotiatorInput(), supportStep, [supportStep], messages, ctx);

    // Duplicate guard: the nudge is already last, so prepareStep leaves messages untouched.
    expect(config.messages).toBeUndefined();
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
    expect(content(messages)).toContain('Deal On The Table');
    // The upfront inspection is stashed for the propose-deal tool to resolve names against.
    expect(input.upfrontInspection).toBeDefined();
    // Inspection runs against the on-the-table deal.
    expect(mcp.calls('inspect-deal')[0]!.args).toHaveProperty('ProposedDeal');
  });

  it('folds inspection values and third-party relationship context into the on-the-table ledger', async () => {
    const deal = {
      version: 1 as const,
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD' as const, amount: 40 }],
      promises: [{ promiserID: 1, recipientID: 3, promiseType: 'COOP_WAR' as const, targetPlayerID: 9 }],
      message: 'Gold and a joint war against Rome.',
    };
    setOpenProposal(7, 1, deal); // counterpart (seat 1) authored it; the negotiator voices seat 3
    mcp.respondWith('inspect-deal', structuredResult({
      items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', legality: true, reasons: [], valueIfIGive: 40, valueIfIReceive: 35 }],
      promises: [{ promiserID: 1, recipientID: 3, promiseType: 'COOP_WAR', targetPlayerID: 9 }],
      promiseTargets: [{ playerID: 9, teamID: 9, name: 'Rome', kind: 'major', coopWarEligible: true }],
      tradableRange: { '1': emptySideRange(), '3': emptySideRange() },
    }));
    const negotiator = new Negotiator();
    const input = negotiatorInput({
      thread: thread({
        player1Identity: { name: 'Carthage', leader: 'Dido' },
        player2Identity: { name: 'Germany', leader: 'Bismarck' },
      }),
    });
    // Our leader's own set-relationship directive rides along the cached game state (no extra fetch).
    const paramsWithRel = {
      ...params,
      gameStates: {
        5: {
          options: { Relationships: { Rome: { Public: -50, Private: -30, Rationale: 'Keep Rome weak.', UpdatedTurn: 4 } } },
          players: {},
        },
      },
    } as any;
    const callTool = vi.fn(async (name: string) => (({
      'get-cities': {},
      'get-players': { '3': { Relationships: { Rome: 'War' } }, '1': { Relationships: { Rome: ['Denounced them'] } } },
      'get-diplomatic-events': {},
    }) as Record<string, unknown>)[name]);

    const text = content(await negotiator.getInitialMessages(paramsWithRel, input, { callTool } as any));

    expect(text).toContain('Deal On The Table (#7)');
    expect(text).not.toContain('Inspection (advisory)');
    // Per-item advisory estimates fold into the term (giver first), not a separate section.
    expect(text).toContain('### Gold: 40');
    // Carthage is the giver here, so its advisory worth reads as a cost (negative); Germany receives.
    expect(text).toContain('Estimated value to Carthage (them): -40');
    expect(text).toContain('Estimated value to Germany (us): 35');
    // Coop-war third-party context: both sides' public relationship + our leader's directive toward Rome.
    expect(text).toContain("Germany's (our) relationship to Rome (third-party): War");
    expect(text).toContain("Our leader's intention for Rome: Public -50/Private -30 (Keep Rome weak.)");
    expect(text).toContain("Carthage's (their) relationship to Rome (third-party): Denounced them");
  });

  it('opens a deal when nothing is on the table (request task)', async () => {
    mcp.respondWith('inspect-deal', structuredResult(emptyInspection));
    const negotiator = new Negotiator();
    const input = negotiatorInput({ intent: 'Improve relations.' });

    const messages = await negotiator.getInitialMessages(params, input, {} as any);

    expect(input.activeProposal).toBeUndefined();
    expect(content(messages)).toContain('no deal from the counterpart');
    // The Give/Take menu is rendered (first-person, by seat name).
    expect(content(messages)).toContain('Can Give');
    expect(input.upfrontInspection).toBeDefined();
    expect(mcp.calls('inspect-deal')[0]!.args).not.toHaveProperty('ProposedDeal');
  });

  it('shows each duration-bearing term its fixed term length in the menu', async () => {
    const durInspection = {
      items: [],
      promises: [],
      promiseTargets: [{ playerID: 9, teamID: 9, name: 'Rome', kind: 'major', coopWarEligible: true }],
      defaultDuration: 30,
      peaceDuration: 15,
      relationshipDuration: 20,
      militaryPromiseDuration: 20,
      coopWarPromiseDuration: 10,
      tradableRange: {
        '1': emptySideRange(), // the counterpart (take side); inspect-deal always returns both seats
        '3': {
          gold: { available: false, max: 0, reasons: [] },
          goldPerTurn: { available: false, reasons: [] },
          resources: [], cities: [], techs: [], thirdPartyPeace: [], thirdPartyWar: [], voteCommitments: [],
          maps: { legal: false, reasons: [] },
          allowEmbassy: { legal: false, reasons: [] },
          openBorders: { legal: true, reasons: [] }, // runs the default deal duration
          declarationOfFriendship: { legal: true, reasons: [] }, // runs the relationship duration
          defensivePact: { legal: false, reasons: [] },
          researchAgreement: { legal: false, reasons: [] },
          peaceTreaty: { legal: false, reasons: [] },
          vassalage: { legal: false, reasons: [] },
          vassalageRevoke: { legal: false, reasons: [] },
        },
      },
    } as any;
    mcp.respondWith('inspect-deal', structuredResult(durInspection));
    const negotiator = new Negotiator();
    const input = negotiatorInput({ intent: 'Improve relations.' });

    const messages = await negotiator.getInitialMessages(params, input, {} as any);
    const text = content(messages);

    expect(text).toContain(`${agreementLabel('OPEN_BORDERS')} (lasts 30 turns)`);
    expect(text).toContain(`${agreementLabel('DECLARATION_OF_FRIENDSHIP')} (Mutual, lasts 20 turns)`);
    // Promises: honored ones show term length; Coop War shows its preparation countdown. Labels come
    // from the canonical PROMISE_METADATA (single source of truth).
    expect(text).toContain(`${PROMISE_METADATA.MILITARY.label} (lasts 20 turns)`);
    expect(text).toContain(`${PROMISE_METADATA.NO_DIGGING.label} (lasts until broken)`);
    expect(text).toContain(`${PROMISE_METADATA.COOP_WAR.label} (targets: Rome, war begins in 10 turns)`);
    // The non-honored promises are out of the contract entirely, so their labels never appear.
    for (const label of [
      "Won't spread my religion to you",
      "Won't spy on you",
      "Won't bully your protected city-state",
      "Won't attack your protected city-state",
    ]) {
      expect(text).not.toContain(label);
    }
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

  it('injects the fresh diplomacy background when the thread carries civ identities', async () => {
    // Wiring check: with identities populated, the builder runs and its fetches flow through
    // context.callTool (the ONLY consumer of context here). The other tests leave identities off, so
    // the builder short-circuits and never touches context.
    mcp.respondWith('inspect-deal', structuredResult(emptyInspection));
    const negotiator = new Negotiator();
    const input = negotiatorInput({
      intent: 'Improve relations.',
      thread: thread({
        player1Identity: { name: 'Rome', leader: 'Augustus Caesar' },
        player2Identity: { name: 'Germany', leader: 'Bismarck' },
      }),
    });
    const callTool = vi.fn(async (name: string) => (({
      'get-cities': { Germany: { Berlin: { Population: 5 } } },
      'get-players': {},
      'get-diplomatic-events': {},
    }) as Record<string, unknown>)[name]);

    const messages = await negotiator.getInitialMessages(params, input, { callTool } as any);

    expect(callTool).toHaveBeenCalledWith('get-cities', expect.anything(), expect.anything());
    // The negotiator voices seat 3 (Germany), so the counterpart is Rome and its own cities render.
    expect(content(messages)).toContain('Cities & Diplomatic Standing (with Rome)');
    expect(content(messages)).toContain("## Germany's Cities (You)");
  });
});

describe('getOutput', () => {
  const negotiator = new Negotiator();

  it('summarizes a rejection for the diplomat to voice, including the outward line', async () => {
    const input = negotiatorInput({
      outcome: { type: 'reject', rationale: 'Insulting.', message: 'We cannot accept these terms.', proposalMessageID: 7, rejectMessageID: 9 },
    });
    const out = await negotiator.getOutput({} as any, input, '');
    expect(out).toContain('REJECTED');
    expect(out).toContain('Insulting.');
    // The negotiator's authored outward line is offered for the diplomat to voice.
    expect(out).toContain('We cannot accept these terms.');
  });

  it('summarizes an acceptance for the diplomat to voice, including the outward line', async () => {
    const input = negotiatorInput({
      outcome: {
        type: 'accept',
        rationale: 'Fair deal.',
        message: 'We gladly accept.',
        proposalMessageID: 7,
        enact: { alreadyEnacted: false, enacted: false } as any,
      },
    });
    const out = await negotiator.getOutput({} as any, input, '');
    expect(out).toContain('ACCEPTED');
    expect(out).toContain('We gladly accept.');
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
    // Unified ledger: direction-grouped, friendly-labelled terms (no civ identities → "Player N").
    expect(out).toContain('Proposed terms:');
    expect(out).toContain('Player 3 Offers To Give Player 1');
    expect(out).toContain('### Gold: 50');
    // The side that gives nothing is rendered explicitly, not omitted, so the
    // reader is told outright that player 1 gives nothing rather than inferring it from a missing block.
    expect(out).toContain('Player 1 Offers To Give Player 3');
    expect(out).toContain('(Nothing)');
  });

  it('returns undefined when no terminal tool recorded a move', async () => {
    const out = await negotiator.getOutput({} as any, negotiatorInput(), '');
    expect(out).toBeUndefined();
  });
});
