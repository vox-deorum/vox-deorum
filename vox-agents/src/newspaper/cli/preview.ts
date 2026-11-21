import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { requireLoopbackRequest } from '../../web/loopback.js';
import { sendError } from '../../web/http-utils.js';
import { mountReplayRoutes } from '../replay/http.js';
import { ReplaySession } from '../replay/session.js';

const configFile = fileURLToPath(new URL('../../../newspaper/vite.config.ts', import.meta.url));
const replayPath = '/api/newspaper/replay';

/** Serve the source reader and one offline replay session on the loopback interface. */
export async function createNewspaperPreview(options: { port?: number } = {}) {
  const session = new ReplaySession();
  const app = express();
  app.use(replayPath, requireLoopbackRequest);
  mountReplayRoutes(app, () => session);
  app.use(replayPath, (_req, res) => { sendError(res, 404, 'Replay route not found.'); });
  /** Load the same reader shell at the old preview URL, retaining its fixture query. */
  app.use((req, _res, next) => {
    if (req.path === '/preview.html') req.url = req.url.replace('/preview.html', '/index.html');
    next();
  });

  const server = createServer(app);
  const vite = await createViteServer({
    configFile,
    server: {
      middlewareMode: { server },
      hmr: { server },
    },
  });
  app.use(vite.middlewares);
  let closing: Promise<void> | undefined;
  /** Stop accepting replay operations and release both the session and the dev listener. */
  function close(): Promise<void> {
    return closing ??= Promise.all([
      session.close(),
      vite.close(),
      new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
          else resolve();
        });
      }),
    ]).then(() => undefined);
  }
  try {
    const listening = once(server, 'listening');
    server.listen(options.port ?? vite.config.server.port ?? 5600, '127.0.0.1');
    await listening;
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The newspaper preview has no TCP listener.');
    return { url: `http://127.0.0.1:${address.port}`, close };
  } catch (error) {
    await close();
    throw error;
  }
}
