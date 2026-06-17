/**
 * @module tests/mock/web/routes
 *
 * Supertest coverage for the config and session route modules — the two the plan
 * prioritizes (agent/telemetry have heavier coupling and live in their own files).
 *
 * The routers are mounted on a bare Express app, exactly as `web/server.ts` mounts them.
 * Filesystem access is spied per-test (the route modules `import fs from 'fs/promises'`,
 * so spying the namespace methods intercepts their calls without disturbing the dozens of
 * transitive modules that also use fs at import time). `runStrategistLoop` is mocked so
 * POST /start never spawns a real game loop, and the MCP client uses the shared mock.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs/promises';

// Never spawn a real strategist loop when POST /api/session/start runs.
vi.mock('../../../src/strategist/loop.js', () => ({
  runStrategistLoop: vi.fn(async () => {}),
}));

// Partial-mock the config util so we can drive loadVoxConfig/refreshConfig/getConfigsDir
// while leaving the default `config` export and everything else intact (many transitive
// modules depend on it).
vi.mock('../../../src/utils/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/config.js')>();
  return {
    ...actual,
    loadVoxConfig: vi.fn(actual.loadVoxConfig),
    refreshConfig: vi.fn(() => actual.refreshConfig?.()),
    getConfigsDir: vi.fn(() => '/fake/configs'),
  };
});

// Replace the MCP client singleton with the shared mock (used by players-summary).
vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import configRoutes from '../../../src/web/routes/config.js';
import sessionRoutes from '../../../src/web/routes/session.js';
import { loadVoxConfig, refreshConfig, getConfigsDir } from '../../../src/utils/config.js';
import { runStrategistLoop } from '../../../src/strategist/loop.js';
import { sessionRegistry } from '../../../src/infra/session-registry.js';
import { installMockMcpClient, structuredResult } from '../../helpers/mock-mcp-client.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/config', configRoutes);
  app.use('/api/session', sessionRoutes);
  return app;
}

const app = makeApp();

beforeEach(() => {
  vi.restoreAllMocks();
  installMockMcpClient();
  (getConfigsDir as Mock).mockReturnValue('/fake/configs');
  (refreshConfig as Mock).mockImplementation(() => {});
});

describe('config routes', () => {
  describe('GET /api/config', () => {
    it('returns merged config plus parsed .env keys', async () => {
      (loadVoxConfig as Mock).mockReturnValue({ agent: { name: 'vox' } });
      vi.spyOn(fs, 'readFile').mockResolvedValue('OPENAI_API_KEY=sk-test\nFOO=bar' as never);

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      expect(res.body.config).toEqual({ agent: { name: 'vox' } });
      expect(res.body.apiKeys).toEqual({ OPENAI_API_KEY: 'sk-test', FOO: 'bar' });
    });

    it('still returns 200 with empty apiKeys when .env is missing', async () => {
      (loadVoxConfig as Mock).mockReturnValue({ agent: { name: 'vox' } });
      vi.spyOn(fs, 'readFile').mockRejectedValue(new Error('ENOENT'));

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      expect(res.body.apiKeys).toEqual({});
    });

    it('returns 500 when the config cannot be loaded', async () => {
      (loadVoxConfig as Mock).mockImplementation(() => {
        throw new Error('parse error');
      });

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/config/check', () => {
    it('reports existence when .env is accessible', async () => {
      vi.spyOn(fs, 'access').mockResolvedValue(undefined as never);
      const res = await request(app).get('/api/config/check');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ exists: true });
    });

    it('reports absence when .env is not accessible', async () => {
      vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));
      const res = await request(app).get('/api/config/check');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ exists: false });
    });
  });

  describe('POST /api/config', () => {
    it('writes the config diff and refreshes when config is provided', async () => {
      const writeFile = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined as never);

      const res = await request(app)
        .post('/api/config')
        .send({ config: { agent: { name: 'changed' }, llms: {} } });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(writeFile).toHaveBeenCalled();
      const [target] = writeFile.mock.calls[0];
      expect(String(target)).toContain('config.json');
      expect(refreshConfig).toHaveBeenCalled();
    });

    it('merges and writes .env keys when apiKeys are provided', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue('EXISTING=old' as never);
      const writeFile = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined as never);

      const res = await request(app)
        .post('/api/config')
        .send({ apiKeys: { NEW_KEY: 'value' } });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      const envWrite = writeFile.mock.calls.find(([p]) => String(p).endsWith('.env'));
      expect(envWrite).toBeDefined();
      const written = String(envWrite![1]);
      expect(written).toContain('EXISTING=old');
      expect(written).toContain('NEW_KEY=value');
    });

    it('returns 500 when writing fails', async () => {
      vi.spyOn(fs, 'writeFile').mockRejectedValue(new Error('EACCES'));

      const res = await request(app)
        .post('/api/config')
        .send({ config: { agent: { name: 'x' }, llms: {} } });

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });
});

describe('session routes', () => {
  describe('GET /api/session/status', () => {
    it('reports inactive when no session is registered', async () => {
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue(undefined);
      const res = await request(app).get('/api/session/status');
      expect(res.status).toBe(200);
      expect(res.body.active).toBe(false);
    });

    it('reports active and includes session status', async () => {
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue({
        getStatus: () => ({ id: 's1', state: 'running' }),
      } as never);
      const res = await request(app).get('/api/session/status');
      expect(res.status).toBe(200);
      expect(res.body.active).toBe(true);
      expect(res.body.session).toEqual({ id: 's1', state: 'running' });
    });
  });

  describe('GET /api/session/configs', () => {
    it('returns [] when the configs directory does not exist', async () => {
      vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));
      const res = await request(app).get('/api/session/configs');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configs: [] });
    });

    it('lists parseable .json configs, skipping seating files and bad JSON', async () => {
      vi.spyOn(fs, 'access').mockResolvedValue(undefined as never);
      vi.spyOn(fs, 'readdir').mockResolvedValue([
        'good.json',
        'game.seating.json',
        'broken.json',
        'notes.txt',
      ] as never);
      vi.spyOn(fs, 'readFile').mockImplementation(async (p: never) => {
        if (String(p).includes('good.json')) return JSON.stringify({ type: 'strategist' });
        return '{ not valid json';
      });

      const res = await request(app).get('/api/session/configs');

      expect(res.status).toBe(200);
      expect(res.body.configs).toHaveLength(1);
      expect(res.body.configs[0].name).toBe('good');
    });
  });

  describe('POST /api/session/start', () => {
    it('rejects a request without a config', async () => {
      const res = await request(app).post('/api/session/start').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/config/i);
    });

    it('rejects when a session is already active', async () => {
      vi.spyOn(sessionRegistry, 'hasActiveSession').mockReturnValue(true);
      const res = await request(app)
        .post('/api/session/start')
        .send({ config: { llmPlayers: {} } });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already active/i);
    });

    it('rejects a config without llmPlayers', async () => {
      vi.spyOn(sessionRegistry, 'hasActiveSession').mockReturnValue(false);
      const res = await request(app)
        .post('/api/session/start')
        .send({ config: { type: 'strategist' } });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/llmPlayers/i);
    });

    it('starts the strategist loop for a valid config', async () => {
      vi.spyOn(sessionRegistry, 'hasActiveSession').mockReturnValue(false);
      const res = await request(app)
        .post('/api/session/start')
        .send({ config: { llmPlayers: { 0: {} } } });
      expect(res.status).toBe(200);
      expect(runStrategistLoop).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /api/session/save', () => {
    it('requires a filename', async () => {
      const res = await request(app).post('/api/session/save').send({ config: {} });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/filename/i);
    });

    it('requires a config', async () => {
      const res = await request(app).post('/api/session/save').send({ filename: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/config/i);
    });

    it('saves a sanitized .json file and echoes the final name', async () => {
      vi.spyOn(fs, 'access').mockResolvedValue(undefined as never);
      const writeFile = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined as never);

      const res = await request(app)
        .post('/api/session/save')
        .send({ filename: 'my/cfg', config: { type: 'strategist', llmPlayers: { 0: {} } } });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.filename).toBe('my_cfg.json');
      expect(writeFile).toHaveBeenCalled();
    });
  });

  describe('DELETE /api/session/config/:filename', () => {
    it('returns 404 when the config file does not exist', async () => {
      vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));
      const res = await request(app).delete('/api/session/config/missing.json');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('deletes an existing config file', async () => {
      vi.spyOn(fs, 'access').mockResolvedValue(undefined as never);
      const unlink = vi.spyOn(fs, 'unlink').mockResolvedValue(undefined as never);
      const res = await request(app).delete('/api/session/config/keep.json');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(unlink).toHaveBeenCalled();
    });
  });

  describe('POST /api/session/stop', () => {
    it('returns 404 when there is no active session', async () => {
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue(undefined);
      const res = await request(app).post('/api/session/stop');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/no active/i);
    });

    it('stops the active session', async () => {
      const stop = vi.fn(async () => {});
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue({ id: 's1', stop } as never);
      const res = await request(app).post('/api/session/stop');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(stop).toHaveBeenCalled();
    });
  });

  describe('GET /api/session/players-summary', () => {
    it('returns 404 when there is no active session', async () => {
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue(undefined);
      const res = await request(app).get('/api/session/players-summary');
      expect(res.status).toBe(404);
    });

    it('returns only the major players from the MCP get-players result', async () => {
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue({ id: 's1' } as never);
      const mcp = installMockMcpClient();
      mcp.respondWith(
        'get-players',
        structuredResult({
          '0': { IsMajor: true, Civilization: 'Rome' },
          '1': { IsMajor: false, Civilization: 'Barbarians' },
          '2': 'string-entry',
        }),
      );

      const res = await request(app).get('/api/session/players-summary');

      expect(res.status).toBe(200);
      expect(Object.keys(res.body.players)).toEqual(['0']);
      expect(res.body.players['0'].Civilization).toBe('Rome');
    });

    it('returns 500 when the MCP call fails', async () => {
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue({ id: 's1' } as never);
      const mcp = installMockMcpClient();
      mcp.failWith('get-players', new Error('mcp down'));

      const res = await request(app).get('/api/session/players-summary');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });
});
