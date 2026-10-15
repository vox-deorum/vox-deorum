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
vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { app, shutdownWebServer, startWebServer } from '../../../src/web/server.js';
import config from '../../../src/utils/config.js';
import { installMockMcpClient } from '../../helpers/mock-mcp-client.js';

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
