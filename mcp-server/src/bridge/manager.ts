/**
 * BridgeManager handles all communication with the Bridge Service
 * Provides stateless APIs for HTTP REST and SSE interactions
 */

import { EventEmitter } from 'events';
import { EventSource } from 'eventsource'
import * as net from 'node:net';
import { createLogger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { LuaFunction } from './lua-function.js';
import { HttpClient, HttpError } from './http-client.js';
import { eventPipeDelimiter } from './protocol.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetch } from 'undici';

const logger = createLogger('BridgeManager');

/**
 * Response from Bridge Service Lua calls
 */
export interface LuaResponse {
  success: boolean;
  result?: any;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

/**
 * Health check response from Bridge Service
 */
export interface HealthResponse {
  success: boolean;
  dll_connected: boolean;
  uptime: number;
  version: string;
}

/**
 * SSE event from Bridge Service
 */
export interface GameEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/**
 * Queued Lua function call request. These promises are only ever resolved
 * (never rejected): callers always receive a LuaResponse, with failures carried
 * as `{ success: false, error }`. Shutdown settles them the same way.
 */
interface QueuedLuaCall {
  functionName: string;
  args: any[];
  resolve: (value: LuaResponse) => void;
}

/**
 * Manager for Bridge Service communication
 */
export class BridgeManager extends EventEmitter {
  private baseUrl: string;
  private luaFunctions: Map<string, LuaFunction>;
  private sseConnection: EventSource | null = null;
  private eventPipeSocket: net.Socket | null = null;
  private eventPipeConnected: boolean = false;
  private connectionRetryTimeout: NodeJS.Timeout | null = null;
  private isDllConnected: boolean = false;
  private httpClient: HttpClient;
  private eventPipeBuffer: string = '';

  /**
   * Create a new BridgeManager instance
   */
  constructor(baseUrl?: string) {
    super();
    this.baseUrl = baseUrl || config.bridge?.url || 'http://127.0.0.1:5000';
    this.luaFunctions = new Map();
    this.httpClient = new HttpClient(this.baseUrl);
    logger.info(`BridgeManager initialized with URL: ${this.baseUrl}`);
    // Start the queue processor loop
    this.startQueueProcessorLoop();
  }

  /**
   * Check if the Bridge Service is healthy and connected
   */
  public async checkHealth(): Promise<HealthResponse> {
    try {
      const response = await this.httpClient.get<{ result: HealthResponse }>('/health');
      const data = response.result;
      this.isDllConnected = data.dll_connected;
      return data;
    } catch (error: unknown) {
      logger.error('Health check failed:', error);
      this.isDllConnected = false;
      throw error;
    }
  }

  /**
   * Execute raw Lua script through Bridge Service
   */
  public async executeLuaScript(script: string): Promise<LuaResponse> {
    try {
      const data = await this.httpClient.post<LuaResponse>('/lua/execute', { script }, { fast: true });

      if (!data.success) {
        logger.error('Lua script execution failed: ' + (JSON.stringify(data)), data.error);
      }

      return data;
    } catch (error: unknown) {
      logger.error('Failed to execute Lua script:', error);
      return {
        success: false,
        error: {
          code: error instanceof HttpError ? error.code : 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Failed to communicate with Bridge Service',
        },
      };
    }
  }

  /**
   * Call a registered Lua function through Bridge Service (queued)
   */
  public async callLuaFunction(functionName: string, args: any[]): Promise<LuaResponse> {
    // Immediately reject if DLL is not connected
    if (!this.isDllConnected) {
      return {
        success: false,
        error: {
          code: 'DLL_DISCONNECTED',
          message: 'DLL is not connected'
        }
      };
    }

    return new Promise((resolve) => {
      this.luaCallQueue.push({
        functionName,
        args,
        resolve
      });
    });
  }

  private luaCallQueue: QueuedLuaCall[] = [];
  private queueProcessorRunning: boolean = false;
  private queueOverflowing: boolean = false;
  /**
   * Start the async queue processor loop
   */
  private async startQueueProcessorLoop(): Promise<void> {
    if (this.queueProcessorRunning) return;
    this.queueProcessorRunning = true;

    // In case we crashed recently
    await this.resumeGame();
    while (this.queueProcessorRunning) {
      if (!this.isDllConnected) {
        // Drop all pending calls when DLL disconnects
        this.dropAllPendingCalls('DLL disconnected');
        // Wait before checking again
        await sleep(200);
        continue;
      }
      // Process a batch
      if (this.luaCallQueue.length > 0) {
        await this.processBatch();
      } else {
        await sleep(20);
      }
    }
    logger.info(`The queue processor has completed.`);
  }

  /**
   * Process a single batch of queued calls
   */
  private async processBatch(): Promise<void> {
    // Extract a batch from the queue
    const batch = this.luaCallQueue.splice(0, Math.min(50, this.luaCallQueue.length));

    try {
      if (this.luaCallQueue.length >= 25) {
        logger.warn(`Batch executing ${batch.length} Lua calls, ${this.luaCallQueue.length} remaining. Pausing for now`);
        if (!this.queueOverflowing) {
          await this.pauseGame();
          this.queueOverflowing = true;
        }
      } else {
        if (this.queueOverflowing) {
          await this.resumeGame();
          this.queueOverflowing = false;
        }
        logger.info(`Batch executing ${batch.length} Lua calls, ${this.luaCallQueue.length} remaining...`);
      }

      // Send the request
      const response = await this.httpClient.post<{ success: boolean; result?: { results: LuaResponse[] }; error?: { message: string } }>('/lua/batch', batch.map(call => ({
        function: call.functionName,
        args: call.args
      })));

      if (response.success && response.result?.results) {
        const results = response.result.results;

        // Match results to original calls
        batch.forEach((call, index) => {
          if (index < results.length) {
            call.resolve(results[index]);
          } else {
            // Shouldn't happen, but handle missing result
            call.resolve({
              success: false,
              error: {
                code: 'BATCH_ERROR',
                message: 'Missing result from batch call'
              }
            });
          }
        });
      } else {
        // Batch failed entirely
        batch.forEach(call => {
          call.resolve({
            success: false,
            error: {
              code: 'BATCH_ERROR',
              message: response.error?.message || 'Batch execution failed'
            }
          });
        });
      }
    } catch (error: unknown) {
      logger.error('Failed to execute batch Lua calls:', error);

      // Resolve all calls with error
      batch.forEach(call => {
        call.resolve({
          success: false,
          error: {
            code: error instanceof HttpError ? error.code : 'NETWORK_ERROR',
            message: error instanceof Error ? error.message : 'Failed to communicate with Bridge Service',
          },
        });
      });
    }
  }

  /**
   * Drop all pending calls with an error
   */
  private dropAllPendingCalls(reason: string): void {
    if (this.luaCallQueue.length === 0) return;

    logger.warn(`Dropping ${this.luaCallQueue.length} pending Lua calls: ${reason}`);

    const error = {
      success: false,
      error: {
        code: 'QUEUE_DROPPED',
        message: reason
      }
    };

    // Always settle pending calls, including on shutdown. Skipping this left any
    // awaiting caller hanging forever when the manager stopped.
    this.luaCallQueue.forEach(call => {
      call.resolve(error);
    });

    this.luaCallQueue = [];
  }
  
  /**
   * Add a LuaFunction to the knowledge of the manager
   */
  public addFunction(func: LuaFunction): void {
    this.luaFunctions.set(func.name, func);
  }

  /**
   * Get a registered LuaFunction by name
   */
  public getFunction(name: string): LuaFunction | undefined {
    return this.luaFunctions.get(name);
  }

  /**
   * Connect to event pipe for game events
   */
  public connectEventPipe(): void {
    const pipeName = config.bridgeService.eventPipe!.name;
    const pipePath = `\\\\.\\pipe\\tmp-app.${pipeName}`;
    logger.info(`Attempting to connect to event pipe: ${pipePath}`);

    // Clean up existing socket if any. Drop its listeners first so a late 'close'
    // from the old socket can't drive reconnection against the new one.
    if (this.eventPipeSocket) {
      this.eventPipeSocket.removeAllListeners();
      this.eventPipeSocket.destroy();
      this.eventPipeSocket = null;
    }

    // Create socket and connect to named pipe
    this.eventPipeSocket = net.createConnection(pipePath);
    this.eventPipeSocket.setEncoding('utf8');

    this.eventPipeSocket.on('connect', () => {
      logger.info('Event pipe connection established');
      this.eventPipeConnected = true;
      this.emit('connected');
      this.clearRetryTimeout();
    });

    this.eventPipeSocket.on('data', (data: string) => {
      // Append to buffer
      this.eventPipeBuffer += data;

      // Process all complete messages framed by the bridge event-pipe protocol.
      const messages = this.eventPipeBuffer.split(eventPipeDelimiter);

      // Keep the last incomplete message in buffer (if any)
      this.eventPipeBuffer = messages.pop() || '';

      // Process each complete message
      messages.forEach(message => {
        const trimmed = message.trim();
        if (trimmed === '') return;

        try {
          const event = JSON.parse(trimmed) as GameEvent;
          this.handleGameEvent(event);
        } catch (error) {
          logger.error('Failed to parse event pipe message:', error);
        }
      });

      logger.debug(`Pipe message handled: ${messages.length}, remaining ${this.eventPipeBuffer.length}`);
    });

    this.eventPipeSocket.on('end', () => {
      logger.warn('Event pipe disconnected (end), retrying');
      this.eventPipeConnected = false;
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.eventPipeSocket.on('close', () => {
      logger.warn('Event pipe disconnected (close), retrying');
      this.eventPipeConnected = false;
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.eventPipeSocket.on('error', (error: Error) => {
      this.eventPipeConnected = false;

      // The pipe is unavailable, so fall back to SSE. connectSSE() is now a no-op
      // when an SSE stream is already open or connecting, so repeated pipe-retry
      // failures no longer tear down and reopen a healthy fallback stream (~1s churn).
      logger.error('Event pipe connection failed, falling back to SSE', error);
      // Unlike disconnectStreams() and the cleanup at the top of connectEventPipe(),
      // we intentionally keep this socket's listeners. This is a live failure (not a
      // shutdown), so letting the following 'close' emit 'disconnected' and schedule a
      // reconnect is desired, alongside the immediate connectSSE() fallback below.
      if (this.eventPipeSocket) {
        this.eventPipeSocket.destroy();
        this.eventPipeSocket = null;
      }
      this.connectSSE();
    });
  }

  /**
   * Handle game event from either event pipe or SSE
   */
  private handleGameEvent(data: GameEvent): void {
    if (data.type == "dll_status") {
      if (this.isDllConnected != data.payload.connected as boolean) {
        this.isDllConnected = data.payload.connected as boolean;
        logger.warn("DLL connected status changed: " + this.isDllConnected);
        // If disconnected, reset functions
        if (!this.dllConnected) this.resetFunctions();
      }
    }
    this.emit('gameEvent', data);
  }

  /**
   * Reset all registered functions (mark as unregistered)
   */
  public resetFunctions(): void {
    if (this.luaFunctions.size == 0) return;
    logger.info('Resetting all registered functions');
    this.luaFunctions.forEach(func => {
      func.resetRegistration();
    });
  }

  /**
   * Connect to SSE stream for game events
   */
  public connectSSE(): void {
    // Don't switch to SSE if we're already connected via event pipe
    if (this.eventPipeConnected) {
      logger.debug('Event pipe is connected, not switching to SSE');
      return;
    }

    // If SSE is already open or mid-connect, leave it alone. This method used to
    // unconditionally tear down and reopen the stream, which (paired with the
    // event-pipe retry loop) reconnected SSE roughly once a second.
    if (this.sseConnection && this.sseConnection.readyState !== EventSource.CLOSED) {
      logger.debug('SSE connection already active, not reconnecting');
      return;
    }

    if (this.sseConnection) {
      this.sseConnection.close();
      this.sseConnection = null;
    }

    try {
      logger.info('Connecting to SSE stream');
      this.sseConnection = new EventSource(`${this.baseUrl}/events`, {
        fetch
      });

      this.sseConnection.onopen = () => {
        logger.info('SSE connection established');
        this.emit('connected');
        this.clearRetryTimeout();
      };

      this.sseConnection.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as GameEvent;
          this.handleGameEvent(data);
        } catch (error) {
          logger.error('Failed to parse SSE event:', error);
        }
      };

      this.sseConnection.onerror = (error) => {
        logger.error('SSE connection error:', error);
        this.emit('disconnected');
        this.scheduleReconnect();
      };
    } catch (error) {
      logger.error('Failed to create SSE connection:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection (tries event pipe first if enabled, then SSE)
   */
  private scheduleReconnect(): void {
    this.clearRetryTimeout();
    const delay = 1000; // Start with 1 second delay
    logger.info(`Scheduling reconnection in ${delay}ms`);
    this.connectionRetryTimeout = setTimeout(() => {
      // Try event pipe first if enabled
      if (config.bridgeService.eventPipe?.enabled) {
        this.connectEventPipe();
      } else {
        this.connectSSE();
      }
    }, delay);
  }

  /**
   * Clear reconnection timeout
   */
  private clearRetryTimeout(): void {
    if (this.connectionRetryTimeout) {
      clearTimeout(this.connectionRetryTimeout);
      this.connectionRetryTimeout = null;
    }
  }

  /**
   * Disconnect from event streams (both event pipe and SSE)
   */
  public disconnectStreams(): void {
    this.clearRetryTimeout();

    // Disconnect event pipe if connected. Drop listeners first so its 'close'
    // does not try to fall back to SSE while we are intentionally shutting down.
    if (this.eventPipeSocket) {
      this.eventPipeSocket.removeAllListeners();
      this.eventPipeSocket.destroy();
      this.eventPipeSocket = null;
      this.eventPipeConnected = false;
      logger.info('Event pipe connection closed');
    }

    // Disconnect SSE if connected. Clear onerror first so the manual close does
    // not schedule a reconnect.
    if (this.sseConnection) {
      this.sseConnection.onerror = null;
      this.sseConnection.close();
      this.sseConnection = null;
      logger.info('SSE connection closed');
    }
  }

  /**
   * Get DLL connection status
   */
  public get dllConnected(): boolean {
    return this.isDllConnected;
  }

  /**
   * Pause the game through Bridge Service
   */
  public async pauseGame(): Promise<boolean> {
    try {
      const data = await this.httpClient.post<{ success: boolean }>('/external/pause', undefined, { fast: true });
      logger.debug('Game pause requested: ' + data.success);
      return data.success === true;
    } catch (error: unknown) {
      logger.error('Failed to pause game:', error);
      return false;
    }
  }

  /**
   * Resume the game through Bridge Service
   */
  public async resumeGame(): Promise<boolean> {
    try {
      const data = await this.httpClient.post<{ success: boolean }>('/external/resume', undefined, { fast: true });
      logger.debug('Game resume requested: ' + data.success);
      return data.success === true;
    } catch (error: unknown) {
      logger.error('Failed to resume game:', error);
      return false;
    }
  }

  /**
   * Register a player for auto-pause when it's their turn
   */
  public async pausePlayer(playerId: number): Promise<boolean> {
    try {
      await this.httpClient.post(`/external/pause-player/${playerId}`, undefined, { fast: true });
      logger.info(`Player ${playerId} registered for auto-pause`);
      return true;
    } catch (error: unknown) {
      logger.warn(`Failed to register player ${playerId} for auto-pause:`, error);
      return false;
    }
  }

  /**
   * Set production mode (enables AI turn cooldown in DLL)
   */
  public async setProductionMode(enabled: boolean): Promise<boolean> {
    try {
      await this.httpClient.post('/external/production-mode', { enabled }, { fast: true });
      logger.info(`Production mode ${enabled ? 'enabled' : 'disabled'}`);
      return true;
    } catch (error: unknown) {
      logger.warn('Failed to set production mode:', error);
      return false;
    }
  }

  /**
   * Unregister a player from auto-pause (resume)
   */
  public async resumePlayer(playerId: number): Promise<boolean> {
    try {
      await this.httpClient.delete(`/external/pause-player/${playerId}`, { fast: true });
      logger.info(`Player ${playerId} unregistered from auto-pause`);
      return true;
    } catch (error: unknown) {
      logger.error(`Failed to unregister player ${playerId} from auto-pause:`, error);
      return false;
    }
  }

  /**
   * Shutdown the manager
   */
  public async shutdown(): Promise<void> {
    logger.info('Shutting down BridgeManager');

    // Stop queue processor
    this.queueProcessorRunning = false;

    // Drop all pending queue items
    this.dropAllPendingCalls('BridgeManager shutting down');

    this.disconnectStreams();
    this.resetFunctions();
    this.removeAllListeners();
    await this.httpClient.shutdown();
  }
}