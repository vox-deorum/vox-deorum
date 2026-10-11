/**
 * @module web/routes/telemetry
 *
 * Telemetry API endpoints for viewing active sessions and stored databases.
 * Provides routes for session tracking, database discovery, span streaming, and trace analysis.
 */

import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import multer from 'multer';
import { createLogger } from '../../utils/logger.js';
import { sqliteExporter } from '../../instrumentation.js';
import { parseDatabaseIdentifier, parseContextIdentifier } from '../../utils/telemetry/identifier-parser.js';
import { sendError } from '../http-utils.js';
import { errorMessage } from '../../utils/errors.js';
import { WorkspaceStore } from '../../utils/workspace/workspace-store.js';
import { materialize } from '../../utils/workspace/materialize.js';
import { zipSink } from '../../utils/workspace/materialize-zip.js';
import type {
  TelemetryDatabasesResponse,
  TelemetryMetadata,
  TelemetrySessionsResponse,
  TelemetrySession,
  SessionSpansResponse,
  DatabaseTracesResponse,
  TraceSpansResponse,
  UploadResponse,
  ErrorResponse,
  Span
} from '../../types/index.js';

const logger = createLogger('telemetry', 'webui');
const router = Router();

/** The seat store path for a game and player, or undefined when the identifiers cannot name one. */
function seatStorePath(gameID: string, playerID: string): string | undefined {
  try {
    if (!/^\d+$/.test(playerID)) return undefined;
    return WorkspaceStore.pathFor(gameID, Number(playerID));
  } catch {
    return undefined;
  }
}

/** Whether a seat workspace store exists on disk. */
function hasWorkspaceStore(gameID: string, playerID: string): boolean {
  const dbPath = seatStorePath(gameID, playerID);
  return dbPath !== undefined && existsSync(dbPath);
}

// Configure multer for file uploads
const upload = multer({
  dest: 'temp/',
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (_req: any, file: any, cb: any) => {
    if (path.extname(file.originalname).toLowerCase() === '.db') {
      cb(null, true);
    } else {
      cb(new Error('Only .db files are allowed'));
    }
  }
});

/**
 * List existing database files with parsed metadata
 */
router.get('/databases', async (_req: Request, res: Response<TelemetryDatabasesResponse | ErrorResponse>) => {
  try {
    const databases: TelemetryMetadata[] = [];

    // Check main telemetry folder
    const telemetryDir = path.join(process.cwd(), 'telemetry');

    // Ensure directories exist
    await fs.mkdir(telemetryDir, { recursive: true });

    // Recursive function to scan directories
    const scanDirectory = async (dir: string, baseDir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Agent workspaces may hold their own .db files, which are not game telemetry
          if (dir === baseDir && entry.name === 'workspaces') continue;
          // Recursively scan subdirectories
          await scanDirectory(fullPath, baseDir);
        } else if (entry.isFile() && entry.name.endsWith('.db') && !entry.name.endsWith('.telepathist.db')) {
          const stats = await fs.stat(fullPath);

          // Parse filename and folder path using utility function
          const identifierInfo = parseDatabaseIdentifier(fullPath, baseDir);

          databases.push({
            folder: identifierInfo.folderPath || '',
            filename: entry.name,
            gameID: identifierInfo.gameID,
            playerID: identifierInfo.playerID.toString(),
            size: stats.size,
            lastModified: stats.mtime.toISOString(),
            hasWorkspace: hasWorkspaceStore(identifierInfo.gameID, identifierInfo.playerID.toString())
          });
        }
      }
    };

    // Start recursive scan from telemetry directory
    await scanDirectory(telemetryDir, telemetryDir);

    res.json({ databases });
  } catch (error) {
    logger.error('Error listing databases', error);
    sendError(res, 500, 'Failed to list databases');
  }
});

/**
 * Download one version of a seat workspace store, head by default, as a zip of ordinary files.
 * The store is only read.
 */
router.get('/workspace/:gameID/:playerID/download', (req: Request, res: Response) => {
  const { gameID, playerID } = req.params;
  const dbPath = seatStorePath(gameID, playerID);
  if (!dbPath || !existsSync(dbPath)) {
    return sendError(res, 404, `No workspace files for game ${gameID} player ${playerID}`);
  }
  const commitParam = req.query.commit;
  if (commitParam !== undefined && !/^\d+$/.test(String(commitParam))) {
    return sendError(res, 400, 'commit must be a whole number');
  }
  try {
    const zip = zipSink();
    const commit = materialize(dbPath, zip.sink, commitParam === undefined ? undefined : Number(commitParam));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${gameID}-player-${playerID}-${commit}.zip"`);
    zip.stream.on('error', (error) => {
      logger.error('Workspace zip stream failed', { error });
      res.destroy(error);
    });
    res.on('close', () => {
      if (!res.writableFinished) zip.stream.destroy();
    });
    zip.stream.pipe(res);
    zip.end();
  } catch (error) {
    const message = errorMessage(error, 'Failed to download workspace files');
    const unknownCommit = message.includes('has no commit');
    if (!unknownCommit) logger.error('Failed to materialize workspace', { error });
    sendError(res, unknownCommit ? 404 : 500, message);
  }
  return;
});

/**
 * Upload a database file
 */
router.post('/upload', upload.single('database'), async (req: Request, res: Response<UploadResponse | ErrorResponse>) => {
  try {
    if (!req.file) {
      return sendError(res, 400, 'No file uploaded');
    }

    const uploadedDir = path.join(process.cwd(), 'telemetry', 'uploaded');
    await fs.mkdir(uploadedDir, { recursive: true });

    // Use original filename if valid, otherwise generate one
    const originalName = req.file.originalname;
    const targetPath = path.join(uploadedDir, originalName);

    // Move file from temp to uploaded directory
    await fs.rename(req.file.path, targetPath);

    res.json({
      success: true,
      filename: originalName,
      path: targetPath
    });
  } catch (error) {
    logger.error('Error uploading database', error);

    // Clean up temp file on error
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    sendError(res, 500, 'Failed to upload database');
  }
  return;
});

/**
 * List active telemetry sessions from SQLiteSpanExporter
 */
router.get('/sessions/active', async (_req: Request, res: Response<TelemetrySessionsResponse>) => {
  // Get active connections (context IDs) from the exporter
  const sessionIds = sqliteExporter.getActiveConnections();

  // Parse session IDs to extract game and player info
  const sessions: TelemetrySession[] = sessionIds.map(sessionId => {
    // Use utility function to parse identifier
    const identifierInfo = parseContextIdentifier(sessionId);
    return {
      sessionId,
      gameID: identifierInfo.gameID !== sessionId ? identifierInfo.gameID : undefined,
      playerID: identifierInfo.playerID.toString()
    };
  });

  res.json({ sessions });
  return;
});

/**
 * Get latest 100 spans for an active session (context)
 */
router.get('/sessions/:id/spans', async (req: Request<{ id: string }>, res: Response<SessionSpansResponse | ErrorResponse>) => {
  const { id: contextId } = req.params;

  // Check if this is an active context
  const activeContexts = sqliteExporter.getActiveConnections();
  if (!activeContexts.includes(contextId)) {
    sendError(res, 404, 'Session not found or not active');
    return;
  }

  // Use the existing connection from getDatabase
  const db = sqliteExporter.getDatabase(contextId);

  // Get latest 100 spans
  const dbSpans = await db.selectFrom('spans')
    .selectAll()
    .orderBy('startTime', 'desc')
    .limit(100)
    .execute();

  // Map database spans to API spans (handle nullable attributes)
  const spans: Span[] = dbSpans.reverse().map(span => ({
    ...span,
    attributes: span.attributes || {}
  }));

  res.json({ spans });
  return;
});

/**
 * Stream new spans for an active session via SSE
 */
router.get('/sessions/:id/stream', (req: Request<{ id: string }>, res: Response) => {
  const { id: contextId } = req.params;

  // Check if this is an active context
  const activeContexts = sqliteExporter.getActiveConnections();
  if (!activeContexts.includes(contextId)) {
    sendError(res, 404, 'Session not found or not active');
    return;
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Send initial connection message
  res.write('event: heartbeat\n\n');

  // Set up event listener for new spans
  const spanListener = (dbSpans: any[]) => {
    try {
      // Map database spans to API spans
      const spans: Span[] = dbSpans.map(span => ({
        id: span.id,
        contextId: span.contextId,
        turn: span.turn ?? null,
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId ?? null,
        name: span.name,
        startTime: span.startTime,
        endTime: span.endTime,
        durationMs: span.durationMs,
        attributes: span.attributes || {},
        statusCode: span.statusCode,
        statusMessage: span.statusMessage ?? null
      }));
      res.write(`event: span\ndata: ${JSON.stringify(spans)}\n\n`);
    } catch (error) {
      logger.error('Error streaming spans', error);
    }
  };

  // Subscribe to span export events for this context
  sqliteExporter.onSpansExported(contextId, spanListener);

  // Set up keep-alive ping every 30 seconds
  const keepAliveId = setInterval(() => {
    res.write(`event:heartbeat\n\n`);
  }, 30000);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(keepAliveId);
    sqliteExporter.offSpansExported(contextId, spanListener);
  });
});

/**
 * Get all traces (root spans) from a database
 * Accepts either:
 * - Direct filename (e.g., "game123-player1.db")
 * - Folder path + filename (e.g., "telemetry/game123-player1.db" or "telemetry/uploaded/game123-player1.db")
 */
router.get('/db/:filename(*)/traces', async (req: Request<{ filename: string }>, res: Response<DatabaseTracesResponse | ErrorResponse>) => {
  try {
    const { filename } = req.params;
    const { limit = '100', offset = '0' } = req.query;

    // Parse the path - it might be just a filename or include folder path
    const db = sqliteExporter.openDatabaseFile(filename);
    if (!db) {
      return sendError(res, 404, 'Database not found');
    }

    try {
      // Get root spans (traces - spans without parent)
      const dbTraces = await db.selectFrom('spans')
        .selectAll()
        .where('parentSpanId', 'is', null)
        .orderBy('startTime', 'desc')
        .limit(parseInt(limit as string))
        .offset(parseInt(offset as string))
        .execute();

      // Map database spans to API spans
      const traces: Span[] = dbTraces.map(span => ({
        ...span,
        attributes: span.attributes || {}
      }));

      res.json({ traces });
    } finally {
      await db.destroy();
    }
  } catch (error) {
    logger.error('Error getting traces', error);
    sendError(res, 500, 'Failed to get traces');
  }
  return;
});

/**
 * Get all spans in a trace
 * Accepts either:
 * - Direct filename (e.g., "game123-player1.db")
 * - Folder path + filename (e.g., "telemetry/game123-player1.db" or "telemetry/uploaded/game123-player1.db")
 */
router.get('/db/:filename(*)/trace/:traceId/spans', async (req: Request<{ filename: string; traceId: string }>, res: Response<TraceSpansResponse | ErrorResponse>) => {
  try {
    const { filename, traceId } = req.params;

    // Parse the path - it might be just a filename or include folder path
    const db = sqliteExporter.openDatabaseFile(filename);
    if (!db) {
      return sendError(res, 404, 'Database not found');
    }

    try {
      // Get all spans in the trace
      const dbSpans = await db.selectFrom('spans')
        .selectAll()
        .where('traceId', '=', traceId)
        .orderBy('startTime', 'asc')
        .execute();

      if (dbSpans.length === 0) {
        return sendError(res, 404, 'Trace not found');
      }

      // Map database spans to API spans
      const spans: Span[] = dbSpans.map(span => ({
        ...span,
        attributes: span.attributes || {}
      }));

      res.json({ spans });
    } finally {
      await db.destroy();
    }
  } catch (error) {
    logger.error('Error getting trace spans', error);
    sendError(res, 500, 'Failed to get trace spans');
  }
  return;
});

export default router;