/**
 * Web UI Server for Vox Agents
 * Provides REST API and SSE endpoints for telemetry, logs, sessions, and agent chat
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import * as fsPromises from 'fs/promises';
import { createLogger } from '../utils/logger.js';
import { sseManager } from './sse-manager.js';
import { sendError } from './http-utils.js';
import config from '../agents/config/load.js';
import telemetryRoutes from './routes/telemetry.js';
import configRoutes from './routes/config.js';
import { createAgentRoutes } from './routes/agent.js';
import sessionRoutes from './routes/session.js';
import { createDebugRoutes } from './routes/debug.js';
import { processManager } from '../agents/runtime/process-manager.js';
import type { HealthStatus, ErrorResponse } from '../types/index.js';
import { allowLoopbackCorsOrigin, requireLoopbackRequest } from './loopback.js';
import { reloadRootPrompts } from '../agents/prompts/prompt-files.js';
import { NewspaperApplication } from '../newspaper/application.js';
import { mountNewspaperRoutes } from '../newspaper/export/http.js';
import { createNewspaperDebugRoutes } from './routes/newspaper.js';
import { ReplaySession } from '../newspaper/replay/session.js';
import { mountReplayRoutes } from '../newspaper/replay/http.js';

// Get __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app
const app = express();
const PORT = config.webui.port;
const shutdownUnavailablePlaceholder = 'unavailable';

// Create loggers using the unified logger utility
// These will automatically stream to SSE when available
const webLogger = createLogger('WebUI', 'webui');    // Web UI logger with source: 'webui'
let activeServer: ReturnType<typeof app.listen> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let activePort: number | null = null;
let shutdownPromise: Promise<void> | undefined;
let newspaper = new NewspaperApplication({ url: getWebServerUrl });
let replay = new ReplaySession();

/** Return the actual bound address while accepted browser exports are still draining. */
export function getWebServerUrl(): string {
  if (activePort === null) throw new Error('The web server is not listening for newspaper exports.');
  return `http://127.0.0.1:${activePort}`;
}

/** Returns a loopback hostname suitable for the local shutdown URL. */
function getShutdownHost(host: string): string {
  if (host === '0.0.0.0' || host === '::' || host === '::1' || host === 'localhost') {
    return '127.0.0.1';
  }

  return host;
}

/** Writes the shutdown discovery value expected by the service launcher. */
async function writeShutdownDiscoveryFile(value: string): Promise<string | null> {
  const shutdownUrlFile = process.env.VOX_SHUTDOWN_URL_FILE;
  if (!shutdownUrlFile) return null;

  await fsPromises.writeFile(shutdownUrlFile, `${value}\n`, 'utf8');
  return shutdownUrlFile;
}

/** Drain newspaper delivery while its browser can still reach the bound web server. */
export function shutdownWebServer(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  if (!activeServer) return Promise.resolve();
  shutdownPromise = closeWebServer();
  return shutdownPromise;
}

/** Close background work before closing HTTP connections and clearing the live address. */
async function closeWebServer(): Promise<void> {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  if (!activeServer) {
    return;
  }

  const server = activeServer;
  try {
    const drained = await Promise.allSettled([replay.close(), newspaper.close()]);
    const failure = drained.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  } finally {
    sseManager.closeAll();
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          webLogger.info('Web UI server closed');
          resolve();
        });
        server.closeAllConnections();
      });
    } finally {
      activeServer = null;
      activePort = null;
    }
  }
}

// Middleware setup
app.use(cors({ origin: allowLoopbackCorsOrigin }));

// Protect every API and shutdown route from cross-origin and DNS-rebinding requests.
app.use(['/api', '/shutdown'], requireLoopbackRequest);
mountNewspaperRoutes(app, {
  /** Mount replay parsing and domain handlers ahead of the newspaper API fallback. */
  mountApplicationRoutes: app => mountReplayRoutes(app, () => replay),
  /** Keep arbitrary exports separate from game activation and expose only the public bundle. */
  exportIssue: async input => {
    const { key, bundle } = await newspaper.exportIssue(input);
    return { key, bundle };
  },
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from dist-ui directory (production build)
const staticPath = path.join(__dirname, '../../dist-ui');

app.use(express.static(staticPath, {
  maxAge: 0,
  etag: false,
  setHeaders: (res, filePath) => {
    // Prevent caching for development
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Set proper content types for specific file extensions
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
  }
}));

// API routes should come before the catch-all route

// Mount telemetry routes
app.use('/api/telemetry', telemetryRoutes);

// Mount config routes
app.use('/api/config', configRoutes);

// Mount agent routes
app.use('/api', createAgentRoutes());

// Mount session routes
app.use('/api/session', sessionRoutes);

// Mount debug page routes (log files, Civ 5 logging switch, log bundle)
app.use('/api/debug', createDebugRoutes());
app.use('/api/debug', createNewspaperDebugRoutes(() => newspaper.showSample()));

// Health check endpoint - minimal API foundation
app.get('/api/health', (_req: Request, res: Response<HealthStatus>) => {
  const healthStatus: HealthStatus = {
    timestamp: new Date().toISOString(),
    service: 'vox-agents-webui',
    version: config.versionInfo?.version || '0.0.0',
    uptime: process.uptime(),
    clients: sseManager.getClientCount(),
    port: activePort ?? PORT
  };
  res.json(healthStatus);
});

// SSE endpoint for log streaming
app.get('/api/logs/stream', (_req: Request, res: Response) => {
  webLogger.info('New SSE client connected');
  sseManager.addClient(res);
});

app.post('/shutdown', (_req: Request, res: Response) => {
  webLogger.info('Received HTTP shutdown request');
  res.status(202).json({ success: true, message: 'Shutdown initiated' });
  setImmediate(() => {
    void processManager.shutdown('http-shutdown');
  });
});

// Return JSON for unknown API endpoints before the SPA fallback can serve index.html.
app.use('/api', (_req: Request, res: Response<ErrorResponse>) => {
  sendError(res, 404, 'API endpoint not found');
});

// Catch-all route for SPA - must come AFTER all API routes
app.get('*', (_req: Request, res: Response<ErrorResponse>) => {
  const indexPath = path.join(staticPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    sendError(res, 404, 'UI not built', {
      details: 'Run "npm run build" in ui/ directory to build the frontend'
    });
  }
});

/** Try to listen on the given port. Resolves with the port on success, null on EADDRINUSE. */
function tryListen(port: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualHost = typeof address === 'object' && address ? address.address : '127.0.0.1';
      const actualPort = typeof address === 'object' && address ? address.port : port;

      activeServer = server;
      activePort = actualPort;
      processManager.register('web-server', async () => {
        await shutdownWebServer();
      });

      webLogger.info(`🌐 Web UI available at: http://localhost:${actualPort}`);
      webLogger.info('Press Ctrl+C to stop the server');
      webLogger.info(`Shutdown endpoint: POST http://${getShutdownHost(actualHost)}:${actualPort}/shutdown`);

      // Start SSE heartbeat to keep connections alive
      heartbeatInterval = sseManager.startHeartbeat();

      const shutdownUrl = `http://${getShutdownHost(actualHost)}:${actualPort}/shutdown`;
      void writeShutdownDiscoveryFile(shutdownUrl)
        .then((shutdownFile) => {
          if (shutdownFile) webLogger.info(`Wrote shutdown URL to ${shutdownFile}`);
        })
        .catch((error) => {
          webLogger.warn(`Failed to write shutdown URL file: ${String(error)}`);
        });

      resolve(actualPort);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(null);
      } else {
        reject(err);
      }
    });
  });
}

// Start server function. It tries the configured port, then falls back to port + 1.
export async function startWebServer(): Promise<number | null> {
  if (activeServer) return activePort;
  shutdownPromise = undefined;
  newspaper = new NewspaperApplication({ url: getWebServerUrl });
  replay = new ReplaySession();
  // The web UI runs agents outside a session, such as telepathist chats, so an invalid root
  // prompt folder fails here instead of in the middle of a chat.
  reloadRootPrompts();
  const result = await tryListen(PORT);
  if (result !== null) return result;

  const fallback = PORT + 1;
  webLogger.warn(`Port ${PORT} is already in use. Trying ${fallback}.`);
  const fallbackResult = await tryListen(fallback);
  if (fallbackResult !== null) return fallbackResult;

  if (!process.env.VOX_SHUTDOWN_URL_FILE) {
    webLogger.warn(`Port ${fallback} is also in use. Skipping Web UI startup.`);
    return null;
  }

  try {
    const shutdownFile = await writeShutdownDiscoveryFile(shutdownUnavailablePlaceholder);
    if (shutdownFile) webLogger.warn(`Wrote shutdown URL placeholder to ${shutdownFile}`);
  } catch (writeError) {
    webLogger.warn(`Failed to write shutdown URL placeholder: ${String(writeError)}`);
  }

  return null;
}

// Export for integration with vox-agents process
export { app };
