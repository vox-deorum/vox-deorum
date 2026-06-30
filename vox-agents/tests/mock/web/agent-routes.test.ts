/**
 * @module tests/mock/web/agent-routes
 *
 * Supertest coverage for the agent route module, focused on the listing endpoints and the
 * request guards that don't require a live VoxContext/session. The registries it reads are
 * spied per-test so no real agents or game contexts are needed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { installMockMcpClient, structuredResult } from '../../helpers/mock-mcp-client.js';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { createAgentRoutes } from '../../../src/web/routes/agent.js';
import { retryMessage } from '../../../src/utils/diplomacy/transcript-utils.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { contextRegistry } from '../../../src/infra/context-registry.js';
import { pacingInterruptionRegistry } from '../../../src/strategist/pacing/registry.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', createAgentRoutes());
  return app;
}

const app = makeApp();

/**
 * A fake VoxContext mirroring the run-model API the agent routes now use (Stage 3): base
 * parameters, a composed `currentParameters`, and `withRun()` that overlays overrides on the base
 * and yields a run handle with an observable `abort`. `withRunCalls`/`runHandles` are exposed for
 * assertions, and context-wide `abort` is a spy so tests can assert the route never calls it.
 */
function makeMockContext(opts: {
  baseParameters?: any;
  session?: { getTurn: () => number | undefined };
  execute?: (...args: any[]) => any;
} = {}) {
  let base = opts.baseParameters;
  let current = base;
  const withRunCalls: any[] = [];
  const runHandles: any[] = [];
  const ctx: any = {
    session: opts.session,
    execute: opts.execute ?? vi.fn(),
    abort: vi.fn(),
    getBaseParameters: () => base,
    setBaseParameters: (p: any) => { base = p; current = p; },
    get currentParameters() { return current; },
    withRunCalls,
    runHandles,
    async withRun(options: any, cb: any) {
      withRunCalls.push(options);
      const composed = options?.overrides ? { ...base, ...options.overrides } : base;
      const aborter = new AbortController();
      const handle = {
        id: `run-${runHandles.length}`,
        parameters: composed,
        signal: aborter.signal,
        tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
        abort: vi.fn(() => aborter.abort()),
      };
      runHandles.push(handle);
      const prev = current;
      current = composed;
      try {
        return await cb(handle);
      } finally {
        current = prev;
      }
    },
  };
  return ctx;
}

beforeEach(() => {
  vi.restoreAllMocks();
  installMockMcpClient();
});

describe('agent routes', () => {
  describe('GET /api/agents', () => {
    it('returns the registered agents as name/description/tags', async () => {
      vi.spyOn(agentRegistry, 'getAll').mockReturnValue([
        { name: 'diplomat', description: 'speaks for a civ', tags: ['diplomacy'] },
      ] as never);

      const res = await request(app).get('/api/agents');

      expect(res.status).toBe(200);
      expect(res.body.agents).toEqual([
        { name: 'diplomat', description: 'speaks for a civ', tags: ['diplomacy'] },
      ]);
    });

    it('defaults tags to an empty array when an agent omits them', async () => {
      vi.spyOn(agentRegistry, 'getAll').mockReturnValue([
        { name: 'observer', description: 'watches' },
      ] as never);

      const res = await request(app).get('/api/agents');
      expect(res.status).toBe(200);
      expect(res.body.agents[0].tags).toEqual([]);
    });

    it('returns 500 when the registry throws', async () => {
      vi.spyOn(agentRegistry, 'getAll').mockImplementation(() => {
        throw new Error('boom');
      });
      const res = await request(app).get('/api/agents');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/agents/pacing-interruptions', () => {
    it('returns the registered interruption strategies', async () => {
      vi.spyOn(pacingInterruptionRegistry, 'getAll').mockReturnValue([
        { name: 'on-war', label: 'On War', description: 'pause on war' },
      ] as never);

      const res = await request(app).get('/api/agents/pacing-interruptions');
      expect(res.status).toBe(200);
      expect(res.body.interruptions).toEqual([
        { name: 'on-war', label: 'On War', description: 'pause on war' },
      ]);
    });
  });

  describe('GET /api/agents/chat/:chatId', () => {
    it('returns 404 for an unknown thread', async () => {
      const res = await request(app).get('/api/agents/chat/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/agents/message guards', () => {
    it('requires a chatId', async () => {
      const res = await request(app).post('/api/agents/message').send({ message: 'hi' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/chat id/i);
    });

    it('returns 404 for an unknown thread', async () => {
      const res = await request(app)
        .post('/api/agents/message')
        .send({ chatId: 'nope', message: 'hi' });
      expect(res.status).toBe(404);
    });

    it('rejects up front (503) and never writes the message when a live context has no available turn', async () => {
      vi.spyOn(contextRegistry, 'get').mockReturnValue(
        // Session present but its live turn is unknown, with the base turn seeded to -1 the way
        // production does — the guard must reject on the undefined session turn, NOT fall back to -1.
        makeMockContext({
          session: { getTurn: () => undefined },
          baseParameters: { turn: -1, gameID: 'g', playerID: 3, gameStates: { 5: { options: {}, players: {} } } },
        }) as any,
      );
      vi.spyOn(agentRegistry, 'get').mockReturnValue({
        name: 'diplomat',
        description: 'Diplomat',
        tags: [],
      } as any);

      const opened = await request(app).post('/api/agents/chat').send({
        agentName: 'diplomat',
        contextId: 'g-player-3',
      });
      expect(opened.status).toBe(200);

      const response = await request(app).post('/api/agents/message').send({
        chatId: opened.body.id,
        message: 'Do not retain this',
      });
      // Fail fast with a plain JSON error BEFORE any append/push (no phantom row, nothing in memory).
      expect(response.status).toBe(503);
      expect(response.body.error).toMatch(/live game turn is not available/i);

      const thread = await request(app).get(`/api/agents/chat/${opened.body.id}`);
      expect(thread.body.messages).toEqual([]);
    });
  });

  describe('POST /api/agents/message - run isolation (Stage 3)', () => {
    function liveBase(turn: number) {
      return {
        turn: -1, before: 0, after: 0,
        gameID: 'g', playerID: 3, mode: 'Flavor', workingMemory: {},
        gameStates: { [turn]: { options: {}, players: {} } },
      };
    }

    /** Open an ordinary live chat over the given mock context and return its thread id. */
    async function openLiveChat(ctx: ReturnType<typeof makeMockContext>) {
      vi.spyOn(contextRegistry, 'get').mockReturnValue(ctx as any);
      vi.spyOn(agentRegistry, 'get').mockReturnValue({ name: 'diplomat', description: 'Diplomat', tags: [] } as any);
      const opened = await request(app).post('/api/agents/chat').send({ agentName: 'diplomat', contextId: 'g-player-3' });
      expect(opened.status).toBe(200);
      return opened.body.id as string;
    }

    it('opens a run at the live turn with a streamProgress sink and never aborts on normal completion', async () => {
      const ctx = makeMockContext({ session: { getTurn: () => 7 }, baseParameters: liveBase(7) });
      ctx.execute = vi.fn(async (_n: string, input: any) => {
        input.messages.push({ message: { role: 'assistant', content: 'hello' }, metadata: { datetime: new Date(), turn: 7 } });
        return input;
      });
      const chatId = await openLiveChat(ctx);

      const res = await request(app).post('/api/agents/message').send({ chatId, message: 'hi' });
      expect(res.status).toBe(200);

      // The whole request ran in one root opened at the live turn (7), carrying the SSE progress sink.
      expect(ctx.withRunCalls).toHaveLength(1);
      expect(ctx.withRunCalls[0].overrides.turn).toBe(7);
      expect(typeof ctx.withRunCalls[0].streamProgress).toBe('function');
      // The diplomat executed as a nested call (no parameter argument — it resolves the run's
      // composed live-turn params), receiving the conversation thread and a stream callback, an
      // onContextLengthError sink (so an overflow surfaces as an error, not a false done), and
      // throwOnError so a real agent failure propagates to the SSE error path instead of being swallowed.
      expect(ctx.execute).toHaveBeenCalledWith(
        'diplomat',
        expect.objectContaining({ messages: expect.anything() }),
        expect.anything(),
        undefined,
        expect.any(Function),
        { throwOnError: true },
      );
      // Normal completion must not cancel anything — not the run, not the context.
      expect(ctx.runHandles[0].abort).not.toHaveBeenCalled();
      expect(ctx.abort).not.toHaveBeenCalled();
    });

    it('aborts only the request run (not the context) when the client disconnects mid-generation', async () => {
      const ctx = makeMockContext({ session: { getTurn: () => 7 }, baseParameters: liveBase(7) });
      // Hang inside the run until the client drops; the route's close listener calls run.abort().
      ctx.execute = vi.fn(() => new Promise(() => {}));
      const chatId = await openLiveChat(ctx);

      const pending = request(app).post('/api/agents/message').send({ chatId, message: 'hi' });
      // superagent dispatches lazily — attach a handler so the request is actually sent.
      const settled = pending.then(() => {}, () => {});
      // Let the request reach the hanging execute, then simulate a client disconnect.
      await new Promise((r) => setTimeout(r, 60));
      pending.abort();
      await settled;
      // Give the server's 'close' handler a tick to fire.
      await new Promise((r) => setTimeout(r, 60));

      expect(ctx.runHandles[0].abort).toHaveBeenCalled();
      // The old behavior aborted the whole context (every sibling run); the new path must not.
      expect(ctx.abort).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/agents/message - diplomacy', () => {
    /** Open a diplomacy thread (caller 1 ↔ target 3) over a live, session-bearing context. */
    async function openDiplomacy(opts: { transcript?: unknown[]; liveTurn?: number; execute?: any } = {}) {
      const turn = opts.liveTurn;
      const mcp = installMockMcpClient();
      mcp.respondWith('read-transcript', structuredResult({ messages: opts.transcript ?? [] }));
      const ctx = makeMockContext({
        // currentTurnOf trusts a session-bearing (live) context's getTurn() verbatim, so an omitted
        // liveTurn leaves it undefined — and the base turn is seeded to -1 the way production does, to
        // prove the guard rejects on the undefined session turn rather than masking it with that -1.
        session: { getTurn: () => turn },
        baseParameters: {
          turn: turn ?? -1, gameID: 'g', playerID: 3,
          gameStates: { [turn ?? 5]: { options: {}, players: {} } },
        },
        execute: opts.execute ?? vi.fn(async (_n: string, input: any) => input),
      });
      vi.spyOn(contextRegistry, 'get').mockReturnValue(ctx as any);
      vi.spyOn(agentRegistry, 'get').mockReturnValue({ name: 'diplomat', description: 'Diplomat', tags: [] } as any);
      const opened = await request(app).post('/api/agents/chat').send({
        mode: 'diplomacy', contextId: 'g-player-3', callerPlayerID: 1, targetPlayerID: 3,
      });
      expect(opened.status).toBe(200);
      return { mcp, ctx, chatId: opened.body.id as string };
    }

    /** A diplomat execute that voices a fixed reply into the thread. */
    const replyWith = (text: string) =>
      vi.fn(async (_n: string, input: any) => {
        input.messages.push({ message: { role: 'assistant', content: text }, metadata: { datetime: new Date(), turn: 5 } });
        return input;
      });

    it('archives the caller text then the diplomat reply, in order (both text)', async () => {
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, execute: replyWith('A measured reply.') });
      let nextID = 30;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({ chatId, message: 'Will you trade?' });
      expect(res.status).toBe(200);

      const appends = mcp.calls('append-message');
      expect(appends.map((c) => c.args.MessageType)).toEqual(['text', 'text']);
      expect(appends[0]!.args.Content).toBe('Will you trade?');   // caller text archived first
      expect(appends[1]!.args.Content).toBe('A measured reply.');  // diplomat reply archived after
    });

    it('archives and streams the shared retry line when the turn produces no spoken reply', async () => {
      // A stuck turn (e.g. the step ceiling was hit) leaves nothing spoken. The route streams the
      // shared retry line and the commit path archives the SAME line, so the user sees a polite request
      // to repeat both live and on reload rather than dead air. (The mock execute pushes no reply.)
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, execute: vi.fn(async (_n: string, input: any) => input) });
      let nextID = 70;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({ chatId, message: 'Will you trade?' });
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/event: done/);

      const appends = mcp.calls('append-message');
      expect(appends.map((c) => c.args.MessageType)).toEqual(['text', 'text']);
      expect(appends[0]!.args.Content).toBe('Will you trade?');
      expect(appends[1]!.args.Content).toBe(retryMessage); // the stuck turn archived the retry line
      expect(res.text).toContain(retryMessage);             // and streamed it to the client
    });

    it('does NOT stream or archive the retry line when the turn handed the deal to the negotiator', async () => {
      // A deal handoff is a deliberate, visible outcome (the deal move, archived by the negotiator's
      // own tool), so a turn that calls call-negotiator without speaking is NOT stuck. The misleading
      // "lost my train of thought" line must not stand in for it — no retry row archived, none streamed.
      const handoff = vi.fn(async (_n: string, input: any) => {
        input.messages.push({
          message: { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'h1', toolName: 'call-negotiator', input: { Briefing: 'x' } }] },
          metadata: { datetime: new Date(), turn: 5 },
        });
        return input;
      });
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, execute: handoff });
      let nextID = 80;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({ chatId, message: 'Will you trade?' });
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/event: done/);

      const appends = mcp.calls('append-message');
      // Only the caller's text is archived; no retry reply row stands in for the handoff.
      expect(appends.map((c) => c.args.MessageType)).toEqual(['text']);
      expect(appends[0]!.args.Content).toBe('Will you trade?');
      expect(res.text).not.toContain(retryMessage);
    });

    it('never archives a {{{Greeting}}} trigger as a caller message', async () => {
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, execute: replyWith('Greetings, neighbor.') });
      let nextID = 40;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({ chatId, message: '{{{Greeting}}}' });
      expect(res.status).toBe(200);

      // Only the diplomat's reply is archived; the special trigger is not a real utterance.
      expect(mcp.calls('append-message').map((c) => c.args.Content)).toEqual(['Greetings, neighbor.']);
    });

    it('never archives a phantom transcript row when the live turn is unavailable (rejects 503 first)', async () => {
      // No liveTurn → the up-front guard must reject BEFORE the durable caller-text append, so the
      // store gets nothing (the prior bug left a phantom row, rolling back only the in-memory copy).
      const { mcp, chatId } = await openDiplomacy({ liveTurn: undefined });

      const res = await request(app).post('/api/agents/message').send({ chatId, message: 'Will you trade?' });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/live game turn is not available/i);
      expect(mcp.calls('append-message')).toHaveLength(0);
    });

    it('rejects with 409 when the conversation was closed THIS turn (not a stale turn-unavailable reason)', async () => {
      const closeRow = {
        ID: 1, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
        SpeakerID: 3, MessageType: 'close', Content: '', Payload: {}, Turn: 5, CreatedAt: 0,
      };
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, transcript: [closeRow] });

      const res = await request(app).post('/api/agents/message').send({ chatId, message: 'still there?' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/closed this turn/i);
      expect(mcp.calls('append-message')).toHaveLength(0); // a locked conversation is never archived or run
    });

    it('allows a message when the conversation was closed on an EARLIER turn', async () => {
      const closeRow = {
        ID: 1, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
        SpeakerID: 3, MessageType: 'close', Content: '', Payload: {}, Turn: 4, CreatedAt: 0,
      };
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, transcript: [closeRow], execute: replyWith('Back to talks.') });
      let nextID = 50;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({ chatId, message: 'back again' });
      expect(res.status).toBe(200);
      expect(mcp.calls('append-message').map((c) => c.args.Content)).toEqual(['back again', 'Back to talks.']);
    });

    it('commits the caller utterance up front and keeps it (no reply) when the agent run fails', async () => {
      // The caller's message is durably committed BEFORE the run (so it precedes any tool-written rows),
      // then the diplomat fails. The route passes throwOnError, so the failure propagates and surfaces
      // as an SSE error event rather than being swallowed into a false `done`; the committed caller row
      // stays put (an append-only store can't unwrite it) and only the unwritten reply is skipped.
      const failing = vi.fn(async () => { throw new Error('LLM exploded'); });
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, execute: failing });
      let nextID = 80;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({ chatId, message: 'Will you trade?' });
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/event: error/);
      expect(res.text).not.toMatch(/event: done/);

      // Only the caller text was archived — the reply never was. And the route passed throwOnError so
      // the agent error actually propagated (without it, execute() swallows it and `done` fires).
      const appends = mcp.calls('append-message');
      expect(appends.map((c) => c.args.MessageType)).toEqual(['text']);
      expect(appends[0]!.args.Content).toBe('Will you trade?');
      expect(failing.mock.calls[0]![5]).toEqual({ throwOnError: true });
    });

    it('commits a deal proposal as the turn, then streams the diplomat reply', async () => {
      // A deal turn reuses this route: the proposal is the durable commit point (archived FIRST, so any
      // tool-written row follows it), then the diplomat streams its reply exactly like a chat message.
      const { mcp, ctx, chatId } = await openDiplomacy({ liveTurn: 5, execute: replyWith('We will weigh your offer.') });
      mcp.respondWith('inspect-deal', structuredResult({ items: [], promises: [], tradableRange: {} }));
      let nextID = 60;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({
        kind: 'deal',
        chatId,
        deal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', amount: 50 }], promises: [] },
        // No expectedProposalID — nothing is open, so this opens a fresh proposal (the server derives the type).
      });

      expect(res.status).toBe(200);
      expect(res.text).toMatch(/event: done/);
      expect(res.text).not.toMatch(/event: error/);
      // The post-commit `connected` event carries the authoritative committed row (real ID 60), so the
      // UI inserts it without a reread/refresh.
      expect(res.text).toMatch(/event: connected/);
      expect(res.text).toMatch(/"deal":\{"ID":60/);

      const appends = mcp.calls('append-message');
      expect(appends.map((c) => c.args.MessageType)).toEqual(['deal-proposal', 'text']);
      expect(appends[1]!.args.Content).toBe('We will weigh your offer.');
      // One root run at the live turn carries the diplomat — the same lifecycle as a chat turn.
      expect(ctx.withRunCalls.some((c: any) => c.overrides?.turn === 5)).toBe(true);
    });

    it('commits a counter bound to the reviewed proposal, then streams the reply', async () => {
      // Proposing and countering are one action. The audience answers the agent's open proposal (ID 7) by
      // submitting a deal with expectedProposalID 7; beginChatTurn reconciles it against the live state
      // under the lock — 7 is still the active open offer — so it archives a deal-counter and the diplomat
      // streams its reply. (The server derives the deal-counter type from the open offer; no wire flag.)
      const proposal = {
        ID: 7, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
        SpeakerID: 3, MessageType: 'deal-proposal', Content: 'Offer',
        Payload: { Deal: { version: 1, items: [], promises: [] } }, Turn: 5, CreatedAt: 0,
      };
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, transcript: [proposal], execute: replyWith('Considering your counter.') });
      mcp.respondWith('inspect-deal', structuredResult({ items: [], promises: [], tradableRange: {} }));
      let nextID = 60;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({
        kind: 'deal',
        chatId,
        deal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', amount: 25 }], promises: [] },
        expectedProposalID: 7,
      });

      expect(res.status).toBe(200);
      expect(res.text).toMatch(/event: done/);
      expect(mcp.calls('append-message').map((c) => c.args.MessageType)).toEqual(['deal-counter', 'text']);
    });

    it('409s a submission whose answered offer is no longer the active one (without archiving or streaming)', async () => {
      // The human reviewed proposal 7, but 9 is the active offer now (a concurrent change slipped in). The
      // submission carries expectedProposalID 7, so the under-lock reconcile rejects it as a conflict BEFORE
      // any archival — a stale submission must never revive a dead negotiation as the new active offer.
      const newer = {
        ID: 9, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
        SpeakerID: 3, MessageType: 'deal-proposal', Content: 'Newer offer',
        Payload: { Deal: { version: 1, items: [], promises: [] } }, Turn: 5, CreatedAt: 0,
      };
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, transcript: [newer] });
      mcp.respondWith('inspect-deal', structuredResult({ items: [], promises: [], tradableRange: {} }));
      mcp.onTool('append-message', () => structuredResult({ ID: 60, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({
        kind: 'deal',
        chatId,
        deal: { version: 1, items: [], promises: [] },
        expectedProposalID: 7,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/no longer the active proposal/i);
      expect(mcp.calls('append-message')).toHaveLength(0);
    });

    it('409s a fresh proposal submitted while an offer is already open (no silent supersede)', async () => {
      // Proposing and countering are one action, validated identically: a fresh submission (no
      // expectedProposalID) while an offer is open is NOT allowed to silently supersede it. beginChatTurn
      // reconciles the submitter's "none open" view against the live open offer (ID 7) — a mismatch — and
      // 409s BEFORE any archival. The submitter must answer the open offer instead.
      const open = {
        ID: 7, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
        SpeakerID: 3, MessageType: 'deal-proposal', Content: 'Open offer',
        Payload: { Deal: { version: 1, items: [], promises: [] } }, Turn: 5, CreatedAt: 0,
      };
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, transcript: [open] });
      mcp.respondWith('inspect-deal', structuredResult({ items: [], promises: [], tradableRange: {} }));
      mcp.onTool('append-message', () => structuredResult({ ID: 60, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({
        kind: 'deal',
        chatId,
        deal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', amount: 50 }], promises: [] },
        // expectedProposalID omitted — submitter believes nothing is open, but offer 7 is.
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/must be answered/i);
      expect(mcp.calls('append-message')).toHaveLength(0);
    });

    it("streams the diplomat's mid-run deal rows on `done` so the board updates without a reload", async () => {
      // The diplomat's negotiator tools write deal rows (counter/accept/reject/enacted) straight to the
      // durable store DURING the streamed reply — they never ride the text stream. After the run the route
      // reconciles those rows and ships the NEW ones on `done`, so the live board reflects the outcome
      // without a full refresh (which would flatten the streamed reasoning/tool traces).
      const counterRow = {
        ID: 77, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
        SpeakerID: 3, MessageType: 'deal-counter', Content: 'Consider this instead.',
        Payload: { Deal: { version: 1, items: [], promises: [] }, Value1: {}, Value2: {} }, Turn: 5, CreatedAt: 0,
      };
      let diplomatCountered = false;
      const execute = vi.fn(async (_n: string, input: any) => {
        diplomatCountered = true; // the diplomat's tool durably wrote a deal-counter mid-run
        input.messages.push({ message: { role: 'assistant', content: 'A measured reply.' }, metadata: { datetime: new Date(), turn: 5 } });
        return input;
      });
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, execute });
      // read-transcript reflects the counter only after the run wrote it (the post-run reconcile reads it).
      mcp.onTool('read-transcript', () => structuredResult({ messages: diplomatCountered ? [counterRow] : [] }));
      let nextID = 60;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({ chatId, message: 'Will you trade?' });
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/event: done/);
      // The diplomat's mid-run counter (ID 77) is reconciled and carried on `done`, not lost until reload.
      expect(res.text).toMatch(/"deals":\[\{"ID":77/);
    });

    it('rejects a structurally malformed deal pre-stream (400, not 502) without archiving', async () => {
      // A term directed outside the conversation pair fails validateDealForThread, which now throws
      // IllegalDealError (a client error) — the route maps it to 400, never a generic 502. inspect-deal
      // is never reached because the structural guard runs first.
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5 });

      const res = await request(app).post('/api/agents/message').send({
        kind: 'deal',
        chatId,
        deal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 9, itemType: 'GOLD', amount: 50 }], promises: [] },
      });

      expect(res.status).toBe(400);
      expect(mcp.calls('append-message')).toHaveLength(0);
    });

    it('rejects an illegal deal pre-stream (400) without archiving or streaming', async () => {
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5 });
      // The legality guard in appendDealProposal throws IllegalDealError BEFORE the SSE opens, so the
      // route maps it to a 400 JSON body and nothing is committed (the optimistic UI card rolls back).
      mcp.respondWith('inspect-deal', structuredResult({
        items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', legality: false, reasons: ['No gold to give'] }],
        promises: [], tradableRange: {},
      }));
      mcp.onTool('append-message', () => structuredResult({ ID: 99, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({
        kind: 'deal',
        chatId,
        deal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', amount: 50 }], promises: [] },
      });

      expect(res.status).toBe(400);
      expect(mcp.calls('append-message')).toHaveLength(0);
    });

    it('rejects a deal turn whose expectedProposalID is not a number (400) before committing anything', async () => {
      // The only shape-level requirement left for a deal turn (propose and counter are one action): when
      // expectedProposalID is supplied it must be a number, so the under-lock reconcile can compare it.
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5 });
      const res = await request(app).post('/api/agents/message').send({
        kind: 'deal',
        chatId,
        deal: { version: 1, items: [], promises: [] },
        expectedProposalID: 'not-a-number',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/expectedProposalID/i);
      expect(mcp.calls('append-message')).toHaveLength(0);
    });

    it('keeps a committed deal proposal but skips the reply when the diplomat run fails', async () => {
      // The proposal is durably committed BEFORE the run, then the diplomat fails. throwOnError surfaces
      // it as an SSE error (not a false `done`); the append-only proposal stays and only the reply is
      // skipped — the streaming counterpart of the human's preliminary card staying on a 'committed' fail.
      const failing = vi.fn(async () => { throw new Error('LLM exploded'); });
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, execute: failing });
      mcp.respondWith('inspect-deal', structuredResult({ items: [], promises: [], tradableRange: {} }));
      let nextID = 80;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({
        kind: 'deal',
        chatId,
        deal: { version: 1, items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', amount: 50 }], promises: [] },
      });

      expect(res.status).toBe(200);
      expect(res.text).toMatch(/event: error/);
      expect(res.text).not.toMatch(/event: done/);
      expect(mcp.calls('append-message').map((c) => c.args.MessageType)).toEqual(['deal-proposal']);
    });

    it('surfaces a context-length overflow as an error, never a false done', async () => {
      // execute() never rethrows a context overflow even under throwOnError (it's reserved for
      // compact-and-retry callers). This route has no retry, so the onContextLengthError sink must turn
      // it into an SSE error — NOT a `done` with an archived partial reply.
      const overflow = vi.fn(async (_n: string, _input: any, _cb: any, _tok: any, onContextLengthError?: () => void) => {
        onContextLengthError?.();
      });
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, execute: overflow });
      let nextID = 90;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({ chatId, message: 'Will you trade?' });
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/event: error/);
      expect(res.text).not.toMatch(/event: done/);

      // Only the caller text was archived — the overflow produced no reply to archive.
      expect(mcp.calls('append-message').map((c) => c.args.MessageType)).toEqual(['text']);
    });

    it('drops a failed {{{Greeting}}} trigger from the cache so the client can re-greet', async () => {
      // The greeting trigger is pushed only so the agent can see it; a failed run must not leave it in
      // the in-memory thread, or the client's greet check would see a phantom row at the current turn
      // and decline a re-greet. (A real caller utterance stays committed; a special trigger does not.)
      const failing = vi.fn(async () => { throw new Error('LLM exploded'); });
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, execute: failing });
      mcp.onTool('append-message', () => structuredResult({ ID: 1, Turn: 5 }));

      const res = await request(app).post('/api/agents/message').send({ chatId, message: '{{{Greeting}}}' });
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/event: error/);

      // Nothing archived (the trigger is never persisted and the reply failed), and the cached thread is
      // back to empty so a later open/refresh re-greets rather than declining.
      expect(mcp.calls('append-message')).toHaveLength(0);
      const after = await request(app).get(`/api/agents/chat/${chatId}`);
      expect(after.body.messages).toHaveLength(0);
    });

    it('rejects a second concurrent turn on the same thread (409) without corrupting the cache', async () => {
      // The cache is mutated by index (push the caller, slice/splice the reply); two overlapping turns
      // on one thread would interleave those indices and delete each other's rows. A gated execute keeps
      // the first turn in flight while the second is posted, so the second must be locked out — committing
      // nothing — rather than racing the first.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const slow = vi.fn(async (_n: string, input: any) => {
        await gate;
        input.messages.push({ message: { role: 'assistant', content: 'A reply.' }, metadata: { datetime: new Date(), turn: 5 } });
        return input;
      });
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, execute: slow });
      let nextID = 110;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      // Fire the first turn but don't await its completion — superagent dispatches lazily on .then(), so
      // the trailing .then() kicks it off; it then parks in the gated execute, holding the thread lock.
      const first = request(app).post('/api/agents/message').send({ chatId, message: 'First message' }).then((r) => r);
      await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(1));

      // The second concurrent turn is rejected up front, before committing or streaming anything.
      const second = await request(app).post('/api/agents/message').send({ chatId, message: 'Second message' });
      expect(second.status).toBe(409);
      expect(second.body.error).toMatch(/already being generated/i);

      // Let the first turn finish; its caller + reply are the only rows that ever reached the store.
      release();
      const firstRes = await first;
      expect(firstRes.status).toBe(200);
      expect(firstRes.text).toMatch(/event: done/);
      expect(mcp.calls('append-message').map((c) => c.args.Content)).toEqual(['First message', 'A reply.']);
    });

    it('serializes the blocking deal/close routes against a streaming turn (409 while in flight)', async () => {
      // A streaming turn holds the per-thread lock for its whole lifecycle. A human-initiated status
      // write (deal reject, conversation close) that arrives mid-stream must 409 rather than interleave
      // with the reply — or the rows the diplomat's own tools write inside that turn. (The Close button
      // is also disabled client-side while streaming; this is the authoritative server backstop.)
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const slow = vi.fn(async (_n: string, input: any) => {
        await gate;
        input.messages.push({ message: { role: 'assistant', content: 'A reply.' }, metadata: { datetime: new Date(), turn: 5 } });
        return input;
      });
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, execute: slow });
      let nextID = 200;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      // Park the first turn inside the gated execute, holding the thread lock (see the concurrent-turn test).
      const first = request(app).post('/api/agents/message').send({ chatId, message: 'First message' }).then((r) => r);
      await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(1));

      // Both a reject and a close are locked out while the turn streams — neither writes anything.
      const reject = await request(app).post(`/api/agents/chat/${chatId}/deal/reject`).send({ proposalMessageID: 1 });
      expect(reject.status).toBe(409);
      expect(reject.body.error).toMatch(/already being generated/i);

      const close = await request(app).post(`/api/agents/chat/${chatId}/close`).send({});
      expect(close.status).toBe(409);

      // Only the streaming turn's own rows ever reached the store (the locked-out writes committed nothing).
      release();
      const firstRes = await first;
      expect(firstRes.status).toBe(200);
      expect(mcp.calls('append-message').map((c) => c.args.MessageType)).toEqual(['text', 'text']);
    });

    it('retracts the open proposal when the conversation is closed', async () => {
      const proposal = {
        ID: 7, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
        SpeakerID: 3, MessageType: 'deal-proposal', Content: 'Offer',
        Payload: { Deal: { version: 1, items: [], promises: [] } }, Turn: 5, CreatedAt: 0,
      };
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5, transcript: [proposal] });
      let nextID = 60;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      const res = await request(app).post(`/api/agents/chat/${chatId}/close`).send({});
      expect(res.status).toBe(200);

      // The open proposal is retracted (a deal-reject referencing it) BEFORE the close is written, so
      // nothing is left enactable on the closed conversation.
      const appends = mcp.calls('append-message');
      expect(appends.map((c) => c.args.MessageType)).toEqual(['deal-reject', 'close']);
      expect(appends[0]!.args.Payload.ProposalMessageID).toBe(7);
    });

    it('writes only the close when there is no open proposal to retract', async () => {
      const { mcp, chatId } = await openDiplomacy({ liveTurn: 5 });
      let nextID = 70;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      const res = await request(app).post(`/api/agents/chat/${chatId}/close`).send({});
      expect(res.status).toBe(200);
      expect(mcp.calls('append-message').map((c) => c.args.MessageType)).toEqual(['close']);
    });
  });

  describe('POST /api/agents/chat guards', () => {
    it('rejects an ordinary chat with no agent name', async () => {
      const res = await request(app).post('/api/agents/chat').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/agent name/i);
    });

    it('returns 404 when the requested agent is unknown', async () => {
      vi.spyOn(agentRegistry, 'get').mockReturnValue(undefined);
      const res = await request(app)
        .post('/api/agents/chat')
        .send({ agentName: 'ghost' });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('rejects a diplomacy chat with no contextId', async () => {
      const res = await request(app)
        .post('/api/agents/chat')
        .send({ mode: 'diplomacy', targetPlayerID: 1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/contextId/i);
    });
  });

  describe('POST /api/agents/chat - audience identity (dialog-sourced)', () => {
    // The live context's game state has an empty players map — the fog-of-war condition that
    // makes server-side civIdentity() return undefined for the audience. The dialog-sent
    // identity must flow onto the thread regardless, so the diplomat never opens with a
    // missing audience civ (the production throw).
    function mockLiveContext() {
      vi.spyOn(contextRegistry, 'get').mockReturnValue(
        makeMockContext({
          baseParameters: { turn: 5, gameID: 'g', playerID: 3, gameStates: { 5: { options: {}, players: {} } } },
        }) as any,
      );
      vi.spyOn(agentRegistry, 'get').mockReturnValue({ name: 'diplomat', description: 'Diplomat', tags: [] } as any);
    }

    it('stores the dialog-sent target and initiator identities on a diplomacy thread', async () => {
      const mcp = installMockMcpClient();
      mcp.respondWith('read-transcript', structuredResult({ messages: [] }));
      mockLiveContext();

      const res = await request(app).post('/api/agents/chat').send({
        mode: 'diplomacy',
        contextId: 'g-player-3',
        callerPlayerID: 1,
        targetPlayerID: 3,
        targetIdentity: { name: 'Germany', leader: 'Bismarck' },
        callerIdentity: { name: 'Rome', leader: 'Caesar' },
      });

      expect(res.status).toBe(200);
      // orderPair(1, 3): player1 is the initiator/audience seat, player2 the voiced target.
      // With the empty (FOW) players map neither civ could be re-resolved server-side, so both
      // must come from the dialog — otherwise the title/self-identity falls back to a bare seat.
      expect(res.body.player1Identity).toEqual({ name: 'Rome', leader: 'Caesar' });
      expect(res.body.player2Identity).toEqual({ name: 'Germany', leader: 'Bismarck' });
      expect(res.body.audienceCiv).toBe('Caesar of Rome');
      expect(res.body.voicedCiv).toBe('Bismarck of Germany');
    });

    it('stores the dialog-sent observer identity on an ordinary chat', async () => {
      mockLiveContext();

      const res = await request(app).post('/api/agents/chat').send({
        agentName: 'diplomat',
        contextId: 'g-player-3',
        callerPlayerID: -1,
        callerRole: 'Observer',
        callerIdentity: { name: 'an observer', leader: '' },
      });

      expect(res.status).toBe(200);
      // orderPair(3, -1): player1 is the observer/audience seat.
      expect(res.body.player1Identity).toEqual({ name: 'an observer', leader: '' });
      expect(res.body.audienceCiv).toBe('an observer');
    });
  });

  describe('mutating endpoints on unknown threads', () => {
    it('DELETE returns 404', async () => {
      const res = await request(app).delete('/api/agents/chat/missing');
      expect(res.status).toBe(404);
    });

    it('close returns 404', async () => {
      const res = await request(app).post('/api/agents/chat/missing/close').send({});
      expect(res.status).toBe(404);
    });
  });

  describe('typed deal-action endpoints on unknown threads', () => {
    // Propose/counter are no longer typed routes — they commit through POST /api/agents/message with a
    // `deal` body (the streaming chat path), covered in the diplomacy block below.
    it('inspect returns 404', async () => {
      const res = await request(app).post('/api/agents/chat/missing/deal/inspect').send({});
      expect(res.status).toBe(404);
    });

    it('reject returns 404', async () => {
      const res = await request(app).post('/api/agents/chat/missing/deal/reject').send({ proposalMessageID: 1 });
      expect(res.status).toBe(404);
    });

    it('accept returns 404', async () => {
      const res = await request(app).post('/api/agents/chat/missing/deal/accept').send({ proposalMessageID: 1 });
      expect(res.status).toBe(404);
    });

    it('list deals returns 404', async () => {
      const res = await request(app).get('/api/agents/chat/missing/deals');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/agents/chat/:chatId/deal/accept', () => {
    /** Open a diplomacy thread backed by the supplied transcript. */
    async function openDiplomacyThread(transcript: unknown[], execute = vi.fn()) {
      const mcp = installMockMcpClient();
      mcp.respondWith('read-transcript', structuredResult({ messages: transcript }));
      const ctx = makeMockContext({
        baseParameters: {
          turn: 5,
          gameID: 'g',
          playerID: 3,
          gameStates: { 5: { options: {}, players: {} } },
        },
        execute,
      });
      vi.spyOn(contextRegistry, 'get').mockReturnValue(ctx as any);
      vi.spyOn(agentRegistry, 'get').mockReturnValue({
        name: 'diplomat',
        description: 'Diplomat',
        tags: [],
      } as any);

      const response = await request(app).post('/api/agents/chat').send({
        mode: 'diplomacy',
        contextId: 'g-player-3',
        callerPlayerID: 1,
        targetPlayerID: 3,
      });
      expect(response.status).toBe(200);
      return { mcp, ctx };
    }

    it('rejects an ID that is not the chat current open proposal', async () => {
      const transcript = [{
        ID: 7,
        Player1ID: 1,
        Player2ID: 3,
        Player1Role: 'the leader',
        Player2Role: 'diplomat',
        SpeakerID: 3,
        MessageType: 'deal-proposal',
        Content: 'Offer',
        Payload: { Deal: { version: 1, items: [], promises: [] } },
        Turn: 5,
        CreatedAt: 0,
      }];
      const { mcp } = await openDiplomacyThread(transcript);

      const response = await request(app)
        .post('/api/agents/chat/dipl:g:1:3/deal/accept')
        .send({ proposalMessageID: 99 });

      expect(response.status).toBe(409);
      expect(mcp.calls('enact-agent-deal')).toHaveLength(0);
    });

    it('accepts only as the human audience endpoint', async () => {
      const transcript = [{
        ID: 8,
        Player1ID: 1,
        Player2ID: 3,
        Player1Role: 'the leader',
        Player2Role: 'diplomat',
        SpeakerID: 3,
        MessageType: 'deal-proposal',
        Content: 'Offer',
        Payload: { Deal: { version: 1, items: [], promises: [] } },
        Turn: 5,
        CreatedAt: 0,
      }];
      const { mcp } = await openDiplomacyThread(transcript);
      mcp.respondWith('enact-agent-deal', structuredResult({
        ProposalMessageID: 8,
        AcceptMessageID: 9,
        EnactedMessageID: 10,
        AlreadyEnacted: false,
        Enacted: false,
        Turn: 5,
      }));

      const response = await request(app)
        .post('/api/agents/chat/dipl:g:1:3/deal/accept')
        .send({ proposalMessageID: 8 });

      expect(response.status).toBe(200);
      expect(mcp.calls('enact-agent-deal')[0]!.args).toMatchObject({
        ProposalMessageID: 8,
        AccepterID: 1,
      });
    });
  });
});
