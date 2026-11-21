/** Verify fixture availability, asset boundaries, and export routes through the renderer test host. */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { startNewspaperHost } from '../../../../src/newspaper/export/http.js';
import { NewspaperBrowserUnavailableError } from '../../../../src/newspaper/export/browser.js';
import { mountReplayRoutes } from '../../../../src/newspaper/replay/http.js';

let fixtureRoot: string | undefined;
afterEach(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  fixtureRoot = undefined;
});

/** Create separate source and installed roots so precedence and traversal can be observed. */
async function createFixtureDirectories() {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), 'vd-newspaper-host-'));
  const directory = path.join(fixtureRoot, 'reader');
  const fixtureDirectory = path.join(fixtureRoot, 'fixtures');
  await mkdir(directory);
  await mkdir(fixtureDirectory);
  await writeFile(path.join(directory, 'sample.json'), JSON.stringify({ issueId: 'packaged-sample' }));
  return { directory, fixtureDirectory };
}

describe('newspaper loopback host', () => {
  it('should deliver parsed replay settings to injected handlers before the API fallback', async () => {
    const handlers = {
      configure: vi.fn(async (body: unknown) => body),
      getState: vi.fn(), evidence: vi.fn(), advance: vi.fn(),
    };
    const host = await startNewspaperHost({
      /** Replay owns its body parser because the host mounts it before the general parser. */
      mountApplicationRoutes: app => mountReplayRoutes(app, () => handlers),
    });
    try {
      const settings = { databasePath: 'recording.db', receiverPlayerID: 0, fromTurn: 5, toTurn: 10, publicationInterval: 2 };
      await request(host.app).put('/api/newspaper/replay').send(settings).expect(200, settings);
      expect(handlers.configure).toHaveBeenCalledExactlyOnceWith(settings);
    } finally { await host.close(); }
  });
  it('should prefer checkout fixture files over the packaged default sample', async () => {
    const directories = await createFixtureDirectories();
    await writeFile(path.join(directories.fixtureDirectory, 'victorian-ordinary.json'), JSON.stringify({ issueId: 'source-sample' }));
    await writeFile(path.join(directories.fixtureDirectory, 'wire-ordinary.json'), JSON.stringify({ issueId: 'source-wire' }));
    const host = await startNewspaperHost(directories);
    try {
      await request(host.app).get('/newspaper/fixtures/victorian-ordinary.json').expect(200, { issueId: 'source-sample' });
      await request(host.app).get('/newspaper/fixtures/wire-ordinary.json').expect(200, { issueId: 'source-wire' });
      await request(host.app).get('/newspaper/fixtures/wire-ordinary.json').set('Host', 'attacker.test').expect(403);
      await request(host.app).get('/newspaper/fixtures/wire-ordinary.json').set('Origin', 'https://attacker.test').expect(403);
    } finally {
      await host.close();
    }
  });

  it('should fall through a missing source fixture directory to the single packaged sample', async () => {
    const directories = await createFixtureDirectories();
    const host = await startNewspaperHost({ ...directories, fixtureDirectory: path.join(fixtureRoot!, 'missing-source') });
    try {
      await request(host.app).get('/newspaper/fixtures/victorian-ordinary.json').expect(200, { issueId: 'packaged-sample' });
      await request(host.app).get('/newspaper/fixtures/wire-ordinary.json').expect(404);
    } finally {
      await host.close();
    }
  });

  it('should keep fixture and reader files contained inside their configured directories', async () => {
    const directories = await createFixtureDirectories();
    await writeFile(path.join(fixtureRoot!, 'private.json'), JSON.stringify({ secret: 'outside-static-roots' }));
    const host = await startNewspaperHost(directories);
    try {
      const response = await request(host.app).get('/newspaper/fixtures/%2e%2e%2fprivate.json');
      expect(response.status).toBe(404);
      expect(response.text).not.toContain('outside-static-roots');
      await request(host.app).get('/newspaper/%2e%2e%2fprivate.json').expect(404);
    } finally {
      await host.close();
    }
  });

  it('should protect injected routes outside the newspaper prefixes before handling requests', async () => {
    const handle = vi.fn((_req, res) => res.json({ turn: 12 }));
    const host = await startNewspaperHost({
      /** Exercise an application route with its own URL namespace. */
      mountApplicationRoutes(app) {
        app.post('/api/replay', handle);
      },
    });
    try {
      await request(host.app).post('/api/replay').set('Host', 'attacker.test').expect(403);
      await request(host.app).post('/api/replay').set('Origin', 'https://attacker.test').expect(403);
      await request(host.app).options('/api/replay').set('Host', 'attacker.test')
        .set('Origin', 'http://localhost').set('Access-Control-Request-Method', 'POST').expect(403);
      expect(handle).not.toHaveBeenCalled();
      await request(host.app).post('/api/replay').expect(200, { turn: 12 });
      expect(handle).toHaveBeenCalledTimes(1);
    } finally {
      await host.close();
    }
  });
  it('should serve injected application routes before the reader and API fallbacks', async () => {
    const host = await startNewspaperHost({
      /** Supply mode-specific routes without coupling the host to that mode. */
      mountApplicationRoutes(app) {
        app.get('/api/newspaper/replay', (_req, res) => res.json({ turn: 12 }));
        app.get('/newspaper/session', (_req, res) => res.send('session'));
      },
    });
    try {
      await request(host.app).get('/api/newspaper/replay').expect(200, { turn: 12 });
      await request(host.app).get('/newspaper/session').expect(200, 'session');
      await request(host.app).get('/api/newspaper/replay').set('Host', 'attacker.test').expect(403);
      await request(host.app).get('/api/newspaper/missing').expect(404);
    } finally {
      await host.close();
    }
  });
  it('should distinguish browser unavailability from invalid export input', async () => {
    const exportIssue = vi.fn()
      .mockRejectedValueOnce(new NewspaperBrowserUnavailableError('Browser unavailable'))
      .mockRejectedValueOnce(new Error('Invalid issue'));
    const host = await startNewspaperHost({ exportIssue });
    try {
      await request(host.app).post('/api/newspaper/export').send({}).expect(503);
      await request(host.app).post('/api/newspaper/export').send({}).expect(400);
    } finally {
      await host.close();
    }
  });
  it('should reject external host and origin requests before export', async () => {
    const exportIssue = vi.fn(async body => body);
    const host = await startNewspaperHost({ exportIssue });
    try {
      await request(host.app).post('/api/newspaper/export').set('Host', 'attacker.test').send({}).expect(403);
      await request(host.app).get('/newspaper/').set('Host', 'attacker.test').expect(403);
      await request(host.app).post('/api/newspaper/export').set('Origin', 'https://attacker.test').send({}).expect(403);
      expect(exportIssue).not.toHaveBeenCalled();
      await request(host.app).post('/api/newspaper/export').send({ value: 1 }).expect(200, { value: 1 });
      expect(exportIssue).toHaveBeenCalledTimes(1);
    } finally {
      await host.close();
    }
  });
});
