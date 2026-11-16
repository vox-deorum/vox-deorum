/**
 * @module tests/mock/web/server
 *
 * Supertest coverage for the complete web server. The shared MCP client mock keeps
 * the test in-process while preserving the same route wiring used in production.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

// Replace the singleton imported by web route modules with the shared MCP mock.
vi.mock('../../../src/agents/mcp/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { app, getWebServerUrl, shutdownWebServer, startWebServer } from '../../../src/web/server.js';
import config from '../../../src/agents/config/load.js';
import { installMockMcpClient } from '../../helpers/mock-mcp-client.js';
import { NewspaperApplication } from '../../../src/newspaper/application.js';
import { createNewspaperBundle } from '../../helpers/newspaper-fixtures.js';
import { deferred } from '../../helpers/deferred.js';
import { ReplaySession } from '../../../src/newspaper/replay/session.js';
import { createReplayRecording, replaySettings } from '../../helpers/newspaper-replay.js';

/** A fake listening server whose address reports the port it was asked to bind. */
function fakeServer(port: number) {
  return Object.assign(new EventEmitter(), {
    address: () => ({ address: '127.0.0.1', port }),
    close: (callback: (error?: Error) => void) => callback(),
    closeAllConnections: vi.fn(),
  });
}

describe('web server', () => {
  let shutdownTempDir: string | undefined;
  const originalShutdownUrlFile = process.env.VOX_SHUTDOWN_URL_FILE;

  beforeEach(() => {
    installMockMcpClient();
  });

  afterEach(async () => {
    await shutdownWebServer();
    if (originalShutdownUrlFile === undefined) {
      delete process.env.VOX_SHUTDOWN_URL_FILE;
    } else {
      process.env.VOX_SHUTDOWN_URL_FILE = originalShutdownUrlFile;
    }
    if (shutdownTempDir) {
      fs.rmSync(shutdownTempDir, { recursive: true, force: true });
      shutdownTempDir = undefined;
    }
    vi.restoreAllMocks();
  });

  it('serves health with the current release version', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.service).toBe('vox-agents-webui');
    expect(response.body.timestamp).toEqual(expect.any(String));
    expect(response.body.version).toBe(config.versionInfo?.version ?? '0.0.0');
  });

  it('returns JSON 404 for an unknown API endpoint', async () => {
    const response = await request(app).get('/api/not-a-route');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'API endpoint not found' });
  });

  it('rejects API requests whose Host header is not loopback', async () => {
    const response = await request(app).get('/api/health').set('Host', 'dashboard.test');

    expect(response.status).toBe(403);
  });

  it('rejects cross-origin shutdown requests', async () => {
    const response = await request(app).post('/shutdown').set('Origin', 'https://attacker.test');

    expect(response.status).toBe(403);
  });

  it('should handle newspaper exports before the smaller dashboard JSON parser and reject oversized input', async () => {
    const cached = { key: 'a'.repeat(64), directory: 'private-cache-path', bundle: createNewspaperBundle() };
    const exportIssue = vi.spyOn(NewspaperApplication.prototype, 'exportIssue').mockResolvedValue(cached);
    const input = { article: 'a'.repeat(150 * 1024) };
    const response = await request(app).post('/api/newspaper/export').send(input);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ key: cached.key, bundle: cached.bundle });
    expect(exportIssue).toHaveBeenCalledExactlyOnceWith(input);
    await request(app).post('/api/newspaper/export').send({ article: 'a'.repeat(2 * 1024 * 1024) }).expect(413);
    expect(exportIssue).toHaveBeenCalledOnce();
  });

  it('should guard newspaper assets and exports before parsing and keep missing assets out of the dashboard fallback', async () => {
    const exportIssue = vi.spyOn(NewspaperApplication.prototype, 'exportIssue');
    await request(app).post('/api/newspaper/export').set('Host', 'attacker.test')
      .set('Content-Type', 'application/json').send('{invalid-json').expect(403);
    await request(app).get('/newspaper/export.html').set('Origin', 'https://attacker.test').expect(403);
    const missing = await request(app).get('/newspaper/missing-reader-asset.js');
    expect(missing.status).toBe(404);
    expect(missing.type).toBe('application/json');
    expect(exportIssue).not.toHaveBeenCalled();
  });

  it('should return debug success only after show completes and report game failures', async () => {
    const result = { success: true as const, issueId: 'sample-issue', key: 'a'.repeat(64) };
    const show = vi.spyOn(NewspaperApplication.prototype, 'showSample').mockResolvedValueOnce(result)
      .mockRejectedValueOnce(new Error('Reader rejected the active seat'));
    await request(app).post('/api/debug/newspaper/show').expect(200, result);
    const rejected = await request(app).post('/api/debug/newspaper/show');
    expect(rejected.status).toBe(503);
    expect(rejected.body.error).toContain('Reader rejected the active seat');
    await request(app).post('/api/debug/newspaper/show').set('Host', 'attacker.test').expect(403);
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('uses the SPA fallback when the UI has not been built', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const response = await request(app).get('/session/123');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'UI not built',
      details: 'Run "npm run build" in ui/ directory to build the frontend',
    });
  });

  it('binds the dashboard server to the loopback interface', async () => {
    const server = fakeServer(7654);
    const listen = vi.spyOn(app, 'listen').mockImplementation(((_port: number, _host: string, callback: () => void) => {
      queueMicrotask(callback);
      return server;
    }) as never);

    await expect(startWebServer()).resolves.toBe(7654);
    expect(listen).toHaveBeenCalledWith(config.webui.port, '127.0.0.1', expect.any(Function));
    await expect(shutdownWebServer()).resolves.toBeUndefined();
  });

  it('should mount parsed replay requests on the current server session and drain replay before closing HTTP', async () => {
    const recording = await createReplayRecording();
    const server = fakeServer(7656);
    const close = vi.spyOn(server, 'close');
    const release = deferred();
    const originalClose = ReplaySession.prototype.close;
    vi.spyOn(ReplaySession.prototype, 'close').mockImplementation(function (this: ReplaySession) {
      return originalClose.call(this).then(() => release.promise);
    });
    vi.spyOn(app, 'listen').mockImplementation(((_port: number, _host: string, callback: () => void) => {
      queueMicrotask(callback);
      return server;
    }) as never);
    let closing: Promise<void> | undefined;
    try {
      await startWebServer();
      await request(app).put('/api/newspaper/replay').send(replaySettings(recording.filename)).expect(200);
      const evidence = await request(app).post('/api/newspaper/replay/advance').expect(200);
      expect(evidence.body.evidence.players[0].values.Gold).toBe(20);
      closing = shutdownWebServer();
      await request(app).post('/api/newspaper/replay/evidence').expect(503);
      expect(close).not.toHaveBeenCalled();
      release.resolve();
      await closing;
      expect(close).toHaveBeenCalledOnce();
    } finally {
      release.resolve();
      await closing;
      await recording.cleanup();
    }
  });

  it('should keep the actual bound address and HTTP connection alive until newspaper work drains', async () => {
    const server = fakeServer(7655);
    const close = vi.spyOn(server, 'close');
    vi.spyOn(app, 'listen').mockImplementation(((_port: number, _host: string, callback: () => void) => {
      queueMicrotask(callback);
      return server;
    }) as never);
    const draining = deferred();
    const drain = vi.spyOn(NewspaperApplication.prototype, 'close').mockReturnValue(draining.promise);
    await startWebServer();
    expect(getWebServerUrl()).toBe('http://127.0.0.1:7655');
    const shutdown = shutdownWebServer();
    expect(shutdownWebServer()).toBe(shutdown);
    expect(drain).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(getWebServerUrl()).toBe('http://127.0.0.1:7655');
    draining.resolve();
    await shutdown;
    expect(close).toHaveBeenCalledOnce();
    expect(() => getWebServerUrl()).toThrow();
  });

  it('should publish the shutdown URL for the fallback port it binds', async () => {
    shutdownTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-server-fallback-'));
    const discoveryPath = path.join(shutdownTempDir, 'shutdown-url.txt');
    process.env.VOX_SHUTDOWN_URL_FILE = discoveryPath;
    const fallbackPort = config.webui.port + 1;
    // The configured port reports EADDRINUSE; the fallback port binds.
    const listen = vi.spyOn(app, 'listen').mockImplementation(((port: number, _host: string, callback: () => void) => {
      const server = fakeServer(port);
      queueMicrotask(() => {
        if (port === config.webui.port) {
          server.emit('error', Object.assign(new Error('in use'), { code: 'EADDRINUSE' }));
        } else {
          callback();
        }
      });
      return server;
    }) as never);

    await expect(startWebServer()).resolves.toBe(fallbackPort);
    expect(listen).toHaveBeenLastCalledWith(fallbackPort, '127.0.0.1', expect.any(Function));
    await vi.waitFor(() => {
      expect(fs.readFileSync(discoveryPath, 'utf8').trim()).toBe(`http://127.0.0.1:${fallbackPort}/shutdown`);
    });
  });
});
