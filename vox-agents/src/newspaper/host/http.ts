/** Independent loopback host for the publication reader and export worker. */
import express, { type Express } from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { allowLoopbackCorsOrigin, requireLoopbackRequest } from '../../web/loopback.js';
import { sendError } from '../../web/http-utils.js';
import { errorMessage } from '../../utils/errors.js';
import { NewspaperBrowserUnavailableError } from '../export/browser.js';

export const readerDirectory = fileURLToPath(new URL('../../../dist-newspaper/', import.meta.url));

export interface NewspaperHostOptions {
  directory?: string;
  fixtureDirectory?: string;
  exportIssue?: (body: unknown) => Promise<unknown>;
}

/** Mount reader routes before a containing application's SPA fallback. */
export function mountNewspaperRoutes(app: Express, options: NewspaperHostOptions = {}): void {
  app.use(['/newspaper', '/api/newspaper'], requireLoopbackRequest);
  if (options.fixtureDirectory) {
    app.use('/newspaper/fixtures', express.static(options.fixtureDirectory));
  }
  app.use('/newspaper', express.static(options.directory ?? readerDirectory, { etag: false, maxAge: 0 }));
  app.post('/api/newspaper/export', express.json({ limit: '2mb' }), async (req, res) => {
    if (!options.exportIssue) {
      sendError(res, 503, 'Newspaper export is unavailable.');
      return;
    }
    try {
      res.json(await options.exportIssue(req.body));
    } catch (error) {
      sendError(res, error instanceof NewspaperBrowserUnavailableError ? 503 : 400, errorMessage(error));
    }
  });
  app.use('/api/newspaper', (_req, res) => { sendError(res, 404, 'Newspaper endpoint not found.'); });
  app.use('/newspaper', (_req, res) => { sendError(res, 404, 'Reader is not built or the asset is unavailable.'); });
}

/** Start an isolated host without importing dashboard, MCP, or strategist startup. */
export async function startNewspaperHost(options: NewspaperHostOptions & { port?: number } = {}) {
  const app = express();
  app.use(cors({ origin: allowLoopbackCorsOrigin }));
  mountNewspaperRoutes(app, options);
  const server = app.listen(options.port ?? 0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Newspaper host has no TCP address.');
  return {
    app,
    url: `http://127.0.0.1:${address.port}`,
    /** Close keep-alive connections as well as the listening socket. */
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
