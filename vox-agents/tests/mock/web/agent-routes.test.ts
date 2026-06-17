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

import { createAgentRoutes } from '../../../src/web/routes/agent.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
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

  describe('GET /api/agents/chats', () => {
    it('returns the in-memory chat threads (empty by default)', async () => {
      const res = await request(app).get('/api/agents/chats');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.chats)).toBe(true);
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
});
