/**
 * @module tests/mock/web/telemetry-routes
 *
 * Supertest coverage for the telemetry route module. The filesystem scan is spied per-test
 * and the `sqliteExporter` singleton is stubbed, so no real telemetry databases are touched.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';

import telemetryRoutes from '../../../../src/web/routes/telemetry.js';
import { sqliteExporter } from '../../../../src/instrumentation.js';
import { config } from '../../../../src/utils/config.js';
import { WorkspaceStore } from '../../../../src/utils/workspace/workspace-store.js';
import { createTelemetryDb } from '../../../helpers/telemetry-db.js';

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

    it('does not list .db files from agent workspaces', async () => {
      vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined as never);
      const readdir = vi.spyOn(fs, 'readdir').mockImplementation((async (dir: string) =>
        dir.endsWith('workspaces')
          ? [{ name: 'stats.db', isDirectory: () => false, isFile: () => true }]
          : [{ name: 'workspaces', isDirectory: () => true, isFile: () => false }]) as never);

      const res = await request(app).get('/api/telemetry/databases');

      expect(res.status).toBe(200);
      expect(res.body.databases).toEqual([]);
      expect(readdir).toHaveBeenCalledTimes(1);
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

    it('should return spans for an active telemetry context', async () => {
      const { db } = createTelemetryDb([{
        contextId: 'active-fixture', turn: 4, traceId: 'trace-fixture', spanId: 'span-fixture',
        name: 'strategist.turn.4', startTime: 10, attributes: { fixture: 'ACTIVE_SPAN_SENTINEL' },
      }]);
      vi.spyOn(sqliteExporter, 'getActiveConnections').mockReturnValue(['active-fixture']);
      vi.spyOn(sqliteExporter, 'getDatabase').mockReturnValue(db);

      try {
        const res = await request(app).get('/api/telemetry/sessions/active-fixture/spans');

        expect(res.status).toBe(200);
        expect(res.body.spans).toEqual([
          expect.objectContaining({
            spanId: 'span-fixture',
            contextId: 'active-fixture',
            attributes: JSON.stringify({ fixture: 'ACTIVE_SPAN_SENTINEL' }),
          }),
        ]);
      } finally {
        await db.destroy();
      }
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

  describe('workspace files', () => {
    const binary = new Uint8Array([0, 1, 2, 250, 255, 0]);
    let dir: string;
    let savedDir: string;
    let first: number;
    let head: number;

    /** Binary-safe supertest parser that collects the response body as a Buffer. */
    const binaryParser = (res: any, callback: (error: Error | null, body: Buffer) => void) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    };

    beforeEach(() => {
      dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'vox-telemetry-ws-'));
      savedDir = config.telemetryDir;
      config.telemetryDir = dir;
      const store = WorkspaceStore.open(WorkspaceStore.pathFor('g1', 2));
      first = store.commit({
        kind: 'turn', turn: 1, author: 'host', changes: [
          { path: 'records/turn-1/state.md', type: 'file', content: 'v1', mode: 0o644, mtime: 1_000_000 },
          { path: 'game/image.bin', type: 'file', content: binary },
          { path: 'game/empty', type: 'dir' },
        ],
      });
      head = store.commit({
        kind: 'notes', turn: 1, author: 'agent', changes: [
          { path: 'records/turn-1/state.md', type: 'file', content: 'v2' },
        ],
      });
      store.close();
    });

    afterEach(() => {
      config.telemetryDir = savedDir;
      fsSync.rmSync(dir, { recursive: true, force: true });
    });

    /** Download a seat zip and unpack it. */
    async function download(url: string) {
      const res = await request(app).get(url).buffer(true).parse(binaryParser);
      return { res, files: res.status === 200 ? unzipSync(new Uint8Array(res.body)) : {} };
    }

    it('flags databases whose seat has a store', async () => {
      vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined as never);
      vi.spyOn(fs, 'readdir').mockResolvedValue([
        { name: 'g1-player-2.db', isDirectory: () => false, isFile: () => true },
        { name: 'g1-player-3.db', isDirectory: () => false, isFile: () => true },
      ] as never);
      vi.spyOn(fs, 'stat').mockResolvedValue({ size: 1, mtime: new Date(0) } as never);

      const res = await request(app).get('/api/telemetry/databases');

      const flags = Object.fromEntries(res.body.databases.map((db: any) => [db.playerID, db.hasWorkspace]));
      expect(flags).toEqual({ '2': true, '3': false });
    });

    it('downloads head as a zip named after the seat and commit', async () => {
      const { res, files } = await download('/api/telemetry/workspace/g1/2/download');

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain(`g1-player-2-${head}.zip`);
      expect(Buffer.from(files['records/turn-1/state.md']).toString()).toBe('v2');
      expect(Array.from(files['game/image.bin'])).toEqual(Array.from(binary));
      expect(Object.keys(files)).toContain('game/empty/');
    });

    it('downloads an older commit as it was', async () => {
      const { res, files } = await download(`/api/telemetry/workspace/g1/2/download?commit=${first}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain(`g1-player-2-${first}.zip`);
      expect(Buffer.from(files['records/turn-1/state.md']).toString()).toBe('v1');
    });

    it('reports a missing store, an unknown commit, and a bad commit as errors', async () => {
      const missing = await request(app).get('/api/telemetry/workspace/g1/9/download');
      expect(missing.status).toBe(404);
      expect(missing.body).toHaveProperty('error');

      const unknown = await request(app).get('/api/telemetry/workspace/g1/2/download?commit=9999');
      expect(unknown.status).toBe(404);
      expect(unknown.body).toHaveProperty('error');

      const bad = await request(app).get('/api/telemetry/workspace/g1/2/download?commit=abc');
      expect(bad.status).toBe(400);
    });

    it('leaves the store unchanged', async () => {
      const dbPath = WorkspaceStore.pathFor('g1', 2);
      const before = fsSync.readFileSync(dbPath);
      await download('/api/telemetry/workspace/g1/2/download');
      const store = WorkspaceStore.open(dbPath, { readonly: true });
      expect(store.head()).toBe(head);
      store.close();
      expect(fsSync.readFileSync(dbPath).equals(before)).toBe(true);
    });
  });
});
