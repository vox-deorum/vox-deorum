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

    it('removes the attempted message when a live context has no available turn', async () => {
      vi.spyOn(contextRegistry, 'get').mockReturnValue({
        session: { getTurn: () => undefined },
        lastParameter: undefined,
        abort: vi.fn(),
      } as any);
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
      expect(response.status).toBe(200);
      expect(response.text).toContain('The live game turn is not available yet');

      const thread = await request(app).get(`/api/agents/chat/${opened.body.id}`);
      expect(thread.body.messages).toEqual([]);
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
      vi.spyOn(contextRegistry, 'get').mockReturnValue({
        lastParameter: { turn: 5, gameID: 'g', playerID: 3, gameStates: { 5: { options: {}, players: {} } } },
        execute: vi.fn(),
      } as any);
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
    const emptyDeal = { version: 1, items: [], promises: [] };

    it('inspect returns 404', async () => {
      const res = await request(app).post('/api/agents/chat/missing/deal/inspect').send({});
      expect(res.status).toBe(404);
    });

    it('propose returns 404', async () => {
      const res = await request(app).post('/api/agents/chat/missing/deal/propose').send({ deal: emptyDeal });
      expect(res.status).toBe(404);
    });

    it('counter returns 404', async () => {
      const res = await request(app).post('/api/agents/chat/missing/deal/counter').send({ deal: emptyDeal });
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
      vi.spyOn(contextRegistry, 'get').mockReturnValue({
        lastParameter: {
          turn: 5,
          gameID: 'g',
          playerID: 3,
          gameStates: { 5: { options: {}, players: {} } },
        },
        execute,
      } as any);
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
      return mcp;
    }

    it('runs the voiced diplomat and persists its reply after a human proposal', async () => {
      const execute = vi.fn(async (_name, _parameters, input) => {
        input.messages.push({
          message: { role: 'assistant', content: 'We will answer this offer.' },
          metadata: { datetime: new Date(), turn: 5 },
        });
        return input;
      });
      const mcp = await openDiplomacyThread([], execute);
      mcp.respondWith('inspect-deal', structuredResult({
        items: [],
        promises: [],
        tradableRange: {},
      }));
      let nextID = 20;
      mcp.onTool('append-message', () => structuredResult({ ID: nextID++, Turn: 5 }));

      const response = await request(app)
        .post('/api/agents/chat/dipl:g:1:3/deal/propose')
        .send({
          deal: {
            version: 1,
            items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', amount: 50 }],
            promises: [],
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.agentResponded).toBe(true);
      expect(execute).toHaveBeenCalledWith(
        'diplomat',
        expect.objectContaining({ playerID: 3 }),
        expect.objectContaining({ id: 'dipl:g:1:3' }),
        undefined,
        undefined,
        undefined,
        { throwOnError: true }
      );
      expect(mcp.calls('append-message').map((call) => call.args.MessageType)).toEqual([
        'deal-proposal',
        'text',
      ]);
      expect(mcp.calls('append-message')[1]!.args.Content).toBe('We will answer this offer.');
    });

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
      const mcp = await openDiplomacyThread(transcript);

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
      const mcp = await openDiplomacyThread(transcript);
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
