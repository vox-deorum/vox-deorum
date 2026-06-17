/**
 * @module tests/mock/web/telemetry-routes
 *
 * Supertest coverage for the telemetry route module. The filesystem scan is spied per-test
 * and the `sqliteExporter` singleton is stubbed, so no real telemetry databases are touched.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs/promises';

import telemetryRoutes from '../../../src/web/routes/telemetry.js';
import { sqliteExporter } from '../../../src/instrumentation.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/telemetry', telemetryRoutes);
  return app;
}

const app = makeApp();

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('telemetry routes', () => {
  describe('GET /api/telemetry/databases', () => {
    it('returns an empty list when the telemetry directory has no .db files', async () => {
      vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined as never);
      vi.spyOn(fs, 'readdir').mockResolvedValue([] as never);

      const res = await request(app).get('/api/telemetry/databases');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ databases: [] });
    });

    it('lists .db files with parsed metadata, skipping .telepathist.db', async () => {
      vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined as never);
      vi.spyOn(fs, 'readdir').mockResolvedValue([
        { name: 'game1-player0.db', isDirectory: () => false, isFile: () => true },
        { name: 'game1-player0.telepathist.db', isDirectory: () => false, isFile: () => true },
        { name: 'notes.txt', isDirectory: () => false, isFile: () => true },
      ] as never);
      vi.spyOn(fs, 'stat').mockResolvedValue({
        size: 4096,
        mtime: new Date('2026-01-01T00:00:00.000Z'),
      } as never);

      const res = await request(app).get('/api/telemetry/databases');

      expect(res.status).toBe(200);
      expect(res.body.databases).toHaveLength(1);
      expect(res.body.databases[0].filename).toBe('game1-player0.db');
      expect(res.body.databases[0].size).toBe(4096);
    });

    it('returns 500 when the directory scan fails', async () => {
      vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined as never);
      vi.spyOn(fs, 'readdir').mockRejectedValue(new Error('EIO'));

      const res = await request(app).get('/api/telemetry/databases');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('POST /api/telemetry/upload', () => {
    it('returns 400 when no file is attached', async () => {
      const res = await request(app).post('/api/telemetry/upload');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/no file/i);
    });
  });

  describe('GET /api/telemetry/sessions/active', () => {
    it('maps active connection ids into session descriptors', async () => {
      vi.spyOn(sqliteExporter, 'getActiveConnections').mockReturnValue(['game1-player-0']);

      const res = await request(app).get('/api/telemetry/sessions/active');

      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(1);
      expect(res.body.sessions[0].sessionId).toBe('game1-player-0');
    });
  });

  describe('GET /api/telemetry/sessions/:id/spans', () => {
    it('returns 404 when the session is not an active context', async () => {
      vi.spyOn(sqliteExporter, 'getActiveConnections').mockReturnValue([]);
      const res = await request(app).get('/api/telemetry/sessions/ghost/spans');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/telemetry/db/:filename/traces', () => {
    it('returns 404 when the database file cannot be opened', async () => {
      vi.spyOn(sqliteExporter, 'openDatabaseFile').mockReturnValue(null as never);
      const res = await request(app).get('/api/telemetry/db/missing.db/traces');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });
});
