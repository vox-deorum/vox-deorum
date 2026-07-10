/**
 * Server-Sent Events endpoint for real-time game event streaming
 */

import { Router, Request, Response } from 'express';
import { createSession, createChannel, createEventBuffer, EventBuffer } from 'better-sse';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger.js';
import { dllConnector } from '../services/dll-connector.js';
import { GameEvent, GameEventMessage } from '../types/event.js';
import { ErrorCode, respondError } from '../types/api.js';
import { pauseManager } from '../services/pause-manager.js';
import { eventPipe } from '../services/event-pipe.js';

const logger = createLogger('EventRoutes');
const router = Router();

// Create a channel for broadcasting events to all connected clients
const eventChannel = createChannel();

// Batching configuration
const BATCH_TIMEOUT_MS = 50; // Flush buffer every 50ms
const BATCH_SIZE_LIMIT = 100;  // Flush buffer when reaching 100 events

// Event buffer management
let eventBuffer: EventBuffer | null = null;
let eventArrayForPipe: GameEvent[] = []; // Track events for event pipe
let flushTimer: NodeJS.Timeout | null = null;
let eventCount = 0;

/**
 * GET /events - Server-Sent Events endpoint for game events
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const clientId = uuidv4();

    logger.info(`New SSE client connected: ${clientId}`);

    // Create a better-sse session
    const session = await createSession(req, res, {
      headers: {
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      },
      retry: 1000
    });

    // Register session with the channel
    eventChannel.register(session);

    // Send initial connection event
    session.push({
      clientId,
      timestamp: new Date().toISOString(),
      message: 'Successfully connected to event stream'
    }, 'connected');

    // Set up keep-alive pings every 5 seconds
    const keepAlive = setInterval(() => {
      if (session.isConnected) {
        session.push({ timestamp: new Date().toISOString() }, 'ping');
      } else {
        clearInterval(keepAlive);
      }
    }, 5000);

    // Handle session disconnect
    session.on('disconnected', () => {
      logger.info(`SSE client disconnected: ${clientId}`);
      clearInterval(keepAlive);
      // Channel automatically handles session cleanup
    });

  } catch (error) {
    logger.error('Error establishing SSE connection:', error);
    // If headers not sent yet, send error response
    if (!res.headersSent) {
      res.status(500).json(respondError(
        ErrorCode.INTERNAL_ERROR,
        'Failed to establish SSE connection',
        error instanceof Error ? error.message : 'Unknown error'
      ));
    }
  }
});

/**
 * Flush the event buffer to all connected clients (SSE and event pipe)
 */
function flushEventBuffer(): void {
  if (!eventBuffer || eventCount === 0) return;

  // Get buffers to send
  const buffer = eventBuffer;
  const eventsForPipe = eventArrayForPipe;
  const currentEventCount = eventCount;

  // Reset buffers and counter
  eventBuffer = createEventBuffer();
  eventArrayForPipe = [];
  eventCount = 0;

  // Clear the flush timer
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  // Send to SSE clients
  if (eventChannel.activeSessions.length > 0) {
    try {
      eventChannel.activeSessions.map(session => session.batch(buffer));
      logger.debug(`Flushed ${currentEventCount} events to ${eventChannel.sessionCount} SSE clients`);
    } catch (error) {
      logger.error('Error flushing SSE event buffer:', error);
    }
  }

  // Send to event pipe clients as a batch
  if (eventsForPipe.length > 0) {
    eventPipe.broadcastBatch(eventsForPipe);
  }
}

/**
 * Schedule a flush based on timeout
 */
function scheduleFlush(): void {
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushEventBuffer();
    }, BATCH_TIMEOUT_MS);
  }
}

/**
 * Broadcast event to all connected SSE clients and event pipe
 * @param gameEvent The event to broadcast
 * @param critical If true, flush the buffer immediately after adding this event
 */
function broadcastEvent(gameEvent: GameEvent, critical: boolean = false): void {
  // Initialize buffer if needed
  if (!eventBuffer) {
    eventBuffer = createEventBuffer();
  }

  // Add event to SSE buffer
  eventBuffer.push({
    id: gameEvent.id,
    type: gameEvent.type,
    payload: gameEvent.payload,
    extraPayload: gameEvent.extraPayload,
    visibility: gameEvent.visibility,
  }, 'message');

  // Add event to pipe buffer
  eventArrayForPipe.push(gameEvent);

  eventCount++;

  // Determine if we should flush
  if (critical || eventCount >= BATCH_SIZE_LIMIT) {
    flushEventBuffer();
  } else {
    scheduleFlush();
  }
}

/**
 * Get SSE and event pipe statistics
 */
export function getSSEStats(): {
  activeClients: number;
  eventPipeStats?: { enabled: boolean; clients: number; pipeName: string };
} {
  return {
    activeClients: eventChannel.sessionCount,
    eventPipeStats: eventPipe.getStats()
  };
}

// Listen for game events from DLL and broadcast to SSE clients
// The DLL performs turn based pausing internally using the paused player set
// synced from the pause manager, so no active player tracking is done here.
dllConnector.on('game_event', (eventData: GameEventMessage) => {
  broadcastEvent({
    type: eventData.event,
    id: eventData.id,
    payload: eventData.payload,
    extraPayload: eventData.extraPayload,
    visibility: eventData.visibility
  });
});

// Send connection status events when DLL connects/disconnects
dllConnector.on('connected', () => {
  const statusEvent: GameEvent = {
    type: 'dll_status',
    payload: { connected: true }
  };
  broadcastEvent(statusEvent, true); // Critical event
});

dllConnector.on('disconnected', () => {
  const statusEvent: GameEvent = {
    type: 'dll_status',
    payload: { connected: false }
  };
  broadcastEvent(statusEvent, true); // Critical event
  pauseManager.clearPausedPlayers();
});

export default router;