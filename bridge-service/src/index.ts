/**
 * Bridge Service Entry Point
 *
 * @module bridge-service
 *
 * @description
 * Express server for Vox Deorum communication layer. This is the main entry point
 * for the Bridge Service, which acts as an IPC bridge between the Community Patch DLL
 * and external services (MCP server, Vox Agents, etc.).
 *
 * The service provides:
 * - REST API for Lua function calls and script execution
 * - External function registration and management
 * - Server-Sent Events (SSE) for real-time game event streaming
 * - Health monitoring and statistics endpoints
 *
 * @see {@link https://github.com/yourusername/vox-deorum/blob/main/protocol.md Protocol Documentation}
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createLogger } from './utils/logger.js';
import { config } from './utils/config.js';
import { bridgeService } from './service.js';
import { getSSEStats } from './routes/events.js';
import luaRoutes from './routes/lua.js';
import externalRoutes from './routes/external.js';
import eventsRoutes from './routes/events.js';
import { respondError, respondSuccess, ErrorCode } from './types/api.js';
import { handleAPIError } from './utils/api.js';
import { createServer } from "http";
import { pauseManager } from './services/pause-manager.js';
import * as fs from 'fs/promises';

const logger = createLogger('Index');
const shutdownUrlFile = process.env.BRIDGE_SHUTDOWN_URL_FILE;
let requestShutdown: (() => void) | null = null;

// Create Express application
const app = express();

/**
 * Middleware setup
 */
app.use(function(req, _res, next) {
  req.socket.setNoDelay(true);
  next();
});

app.use(cors({
  origin: true, // Allow all origins for development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control']
}));

// Request parsing
app.use(express.json({ limit: '10mb' })); // Increase limit for large Lua scripts
app.use(express.urlencoded({ extended: true }));

/**
 * Request logging middleware
 */
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const originalSend = res.send;
  
  res.send = function(body) {
    const duration = Date.now() - start;
    logger.debug(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    return originalSend.call(this, body);
  };
  
  next();
});

/**
 * Health check endpoint
 */
app.get('/health', async (_req: Request, res: Response) => {
  await handleAPIError(res, '/health', async () => {
    const healthStatus = bridgeService.getHealthStatus();
    
    return respondSuccess(healthStatus);
  });
});

/**
 * Service statistics endpoint (for debugging/monitoring)
 */
app.get('/stats', async (_req: Request, res: Response) => {
  await handleAPIError(res, '/stats', async () => {
    const stats = bridgeService.getServiceStats();
    const sseStats = getSSEStats();
    
    return respondSuccess({
      ...stats,
      sse: sseStats
    });
  });
});

function getShutdownHost(host: string): string {
  if (host === '0.0.0.0' || host === '::' || host === '::1' || host === 'localhost') {
    return '127.0.0.1';
  }

  return host;
}

async function writeShutdownUrlFile(host: string, port: number): Promise<void> {
  if (!shutdownUrlFile) return;

  const shutdownUrl = `http://${getShutdownHost(host)}:${port}/shutdown`;
  await fs.writeFile(shutdownUrlFile, `${shutdownUrl}\n`, 'utf8');
  logger.info(`Wrote shutdown URL to ${shutdownUrlFile}`);
}

app.post('/shutdown', (_req: Request, res: Response) => {
  logger.info('Received HTTP shutdown request');
  res.status(202).json({ success: true, message: 'Shutdown initiated' });

  setImmediate(() => {
    requestShutdown?.();
  });
});

/**
 * Route handlers
 */
app.use('/lua', luaRoutes);
app.use('/external', externalRoutes);
app.use('/events', eventsRoutes);

/**
 * Default route
 */
app.get('/', async (_req: Request, res: Response) => {
  await handleAPIError(res, '/', async () => {
    return respondSuccess({
      service: 'Vox Deorum Bridge Service',
      version: process.env.npm_package_version || '1.0.0',
      status: bridgeService.isServiceRunning() ? 'running' : 'stopped',
      endpoints: {
        health: '/health',
        shutdown: 'POST /shutdown',
        stats: '/stats',
        lua: {
          call: 'POST /lua/call',
          batch: 'POST /lua/batch',
          execute: 'POST /lua/execute',
          functions: 'GET /lua/functions'
        },
        external: {
          register: 'POST /external/register',
          unregister: 'DELETE /external/register/:name',
          functions: 'GET /external/functions'
        },
        events: 'GET /events (Server-Sent Events)'
      },
      documentation: 'See README.md and protocol.md for detailed API documentation'
    });
  });
});

/**
 * 404 handler
 */
app.use('*', (req: Request, res: Response) => {
  const response = respondError(
    ErrorCode.NOT_FOUND,
    `Endpoint not found: ${req.method} ${req.originalUrl}`,
    'Check the API documentation for available endpoints'
  );
  res.status(404).json(response);
});

/**
 * Global error handler
 */
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error:', error);

  const response = respondError(
    ErrorCode.INTERNAL_ERROR,
    'Internal server error',
    process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
  );
  
  res.status(500).json(response);
});

/**
 * Start the Bridge Service server
 *
 * @description
 * Initializes and starts the HTTP server with graceful shutdown handlers.
 * This function:
 * 1. Starts the Bridge Service (DLL connection, event pipe)
 * 2. Creates HTTP server with keep-alive timeout
 * 3. Sets up graceful shutdown on SIGTERM, SIGINT, and SIGBREAK
 * 4. Handles uncaught exceptions and unhandled promise rejections
 *
 * @returns Promise that resolves when the server is successfully started
 * @throws Error if the server fails to start
 *
 * @example
 * ```typescript
 * await startServer();
 * // Server is now listening on configured host:port
 * ```
 */
async function startServer(): Promise<void> {
  try {
    // Start the bridge service first
    logger.info('Starting Bridge Service...');
    await bridgeService.start();
    
    // Start HTTP server
    const server = createServer(app);
    let shuttingDown = false;

    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;

      logger.info('Shutting down HTTP server...');

      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            logger.info('HTTP server closed');
            resolve();
          });
          server.closeAllConnections();
        });

        await bridgeService.shutdown();
        pauseManager.finalize();
        logger.info('Server shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    requestShutdown = () => {
      void shutdown();
    };

    server.keepAliveTimeout = 3600000; // 3600 seconds keep-alive timeout
    server.listen(config.rest.port, config.rest.host, () => {
      const address = server.address();
      const actualHost = typeof address === 'object' && address ? address.address : config.rest.host;
      const actualPort = typeof address === 'object' && address ? address.port : config.rest.port;

      logger.info(`Bridge Service HTTP server listening on http://${actualHost}:${actualPort}`);
      logger.info('Service endpoints:');
      logger.info(`  Health: GET http://${actualHost}:${actualPort}/health`);
      logger.info(`  Shutdown: POST http://${actualHost}:${actualPort}/shutdown`);
      logger.info(`  Lua API: http://${actualHost}:${actualPort}/lua/*`);
      logger.info(`  External API: http://${actualHost}:${actualPort}/external/*`);
      logger.info(`  Events Stream: GET http://${actualHost}:${actualPort}/events`);
      logger.info('Bridge Service is ready to accept connections');

      void writeShutdownUrlFile(actualHost, actualPort).catch((error) => {
        logger.warn(`Failed to write shutdown URL file: ${String(error)}`);
      });
    });

    process.on('SIGTERM', shutdown);
    process.on('SIGBREAK', shutdown);
    process.on('SIGINT', shutdown);

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception - shutting down:', error);
      shutdown();
    });

    process.on('unhandledRejection', (reason, _promise) => {
      logger.error('Unhandled Promise Rejection:', reason);
      // Don't exit on unhandled promise rejection in production
      if (process.env.NODE_ENV === 'development') {
        shutdown();
      }
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (process.argv[1].endsWith("index.js")) {
  startServer().catch((error) => {
    logger.error('Failed to start Bridge Service:', error);
    process.exit(1);
  });
}

export { app, startServer };
export default app;
