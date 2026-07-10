/**
 * DLL Connector Service
 *
 * @module bridge-service/services/dll-connector
 *
 * @description
 * Manages Windows Named Pipe IPC connection to the Community Patch DLL using node-ipc.
 * Handles message batching, automatic reconnection, and request/response tracking.
 *
 * Communication protocol:
 * - Messages are JSON-encoded and delimited with "!@#$%^!"
 * - Supports batch sending to reduce IPC overhead
 * - Implements exponential backoff for reconnection (capped at 5 seconds)
 * - Tracks pending requests with timeout handling
 *
 * @see {@link https://github.com/yourusername/vox-deorum/blob/main/protocol.md Protocol Documentation}
 */

import ipc from 'node-ipc';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import guardTimeout from 'guard-timeout';
import { createLogger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { IPCMessage } from '../types/event.js';
import { APIResponse, ErrorCode, respondError, respondSuccess } from '../types/api.js';

const logger = createLogger('DLLConnector');

/**
 * Pending request tracking interface
 *
 * @interface PendingRequest
 * @template T - Type of the expected response data
 *
 * @remarks
 * This request never rejects. Both successful and error responses are delivered
 * through settle as APIResponse values (errors are failed APIResponse objects,
 * never thrown or promise-rejected), so a single settle callback covers every path.
 */
interface PendingRequest<T = any> {
  settle: (response: APIResponse<T>) => void;
  timeout: NodeJS.Timeout;
}

/**
 * DLL Connector class for managing IPC communication
 *
 * @class DLLConnector
 * @extends EventEmitter
 *
 * @description
 * Manages bidirectional communication with the Community Patch DLL through Windows Named Pipes.
 * Implements automatic reconnection, message batching, and request timeout handling.
 *
 * @fires DLLConnector#connected - Emitted when connection to DLL is established
 * @fires DLLConnector#disconnected - Emitted when connection to DLL is lost
 * @fires DLLConnector#game_event - Emitted when game event received from DLL
 * @fires DLLConnector#lua_register - Emitted when Lua function is registered
 * @fires DLLConnector#lua_unregister - Emitted when Lua function is unregistered
 * @fires DLLConnector#lua_clear - Emitted when Lua registry is cleared
 * @fires DLLConnector#external_call - Emitted when external function is called from Lua
 * @fires DLLConnector#ipc_send - Emitted for testing purposes when message is sent
 *
 * @example
 * ```typescript
 * import { dllConnector } from './services/dll-connector.js';
 *
 * // Connect to DLL
 * await dllConnector.connect();
 *
 * // Send a message
 * const response = await dllConnector.send({
 *   type: 'lua_call',
 *   function: 'Game.GetGameTurn',
 *   args: {}
 * });
 *
 * // Listen for game events
 * dllConnector.on('game_event', (event) => {
 *   console.log('Game event:', event.event);
 * });
 * ```
 */
export class DLLConnector extends EventEmitter {
  private connected: boolean = false;
  private shuttingDown: boolean = false;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private reconnectAttempts: number = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private messageBuffer: string = ''; // Buffer for incomplete messages

  constructor() {
    super();
    this.setupIPC();
  }

  /**
   * Configure IPC settings
   */
  private setupIPC(): void {
    ipc.config.id = 'bridge-service';
    ipc.config.maxRetries = false; // Infinite retries
    ipc.config.silent = true; // We'll handle our own logging
    ipc.config.rawBuffer = true;
    ipc.config.encoding = 'utf8';
  }

  /**
   * Connect to the DLL via IPC
   */
  public async connect(): Promise<boolean> {
    this.shuttingDown = false;
    if (this.connected) {
      logger.info('Already connected to DLL');
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      logger.info(`Connecting to DLL with ID: ${config.gamepipe.id}`);

      ipc.connectTo(config.gamepipe.id, () => {
        ipc.of[config.gamepipe.id].on('connect', () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          logger.info('Connected to DLL successfully');
          this.emit('connected');
          
          // Wait for 100ms for Windows Named Pipe to work
          setTimeout(() => {
            resolve(true);
          }, 100);
        }).on('disconnect', () => {
          if (this.shuttingDown) {
            logger.warn('Disconnected from DLL, shutting down...');
          } else {
            if (this.connected)
              logger.warn('Disconnected from DLL, reconnecting...');
            this.handleDisconnection();
          }
          this.emit('disconnected');
        }).on('error', (error: Error) => {
          if (!this.connected) {
            // For initial connection failures, also start reconnection attempts
            logger.warn(`Could not connect to DLL: ${error.message}, waiting for the game and mod to load...`);
            this.handleDisconnection();
            resolve(false);
          } else {
            logger.error('IPC error:', error);
          }
        }).on('data', (data: Buffer) => {
          // Add incoming data to the buffer
          this.messageBuffer += data.toString();

          // Process all complete messages (those ending with delimiter)
          const delimiter = '!@#$%^!';
          let delimiterIndex = this.messageBuffer.indexOf(delimiter);

          while (delimiterIndex !== -1) {
            // Extract the complete message (without delimiter)
            const message = this.messageBuffer.substring(0, delimiterIndex);

            // Remove the processed message and delimiter from buffer
            this.messageBuffer = this.messageBuffer.substring(delimiterIndex + delimiter.length);

            // Process the message if not empty
            if (message.trim()) {
              logger.debug('Received message: ' + message);
              this.handleMessage(message);
            }

            // Look for the next delimiter
            delimiterIndex = this.messageBuffer.indexOf(delimiter);
          }

          // Any remaining data in the buffer is an incomplete message
          // It will be processed when the rest arrives
          if (this.messageBuffer.length > 0) {
            logger.debug(`Buffering incomplete message (${this.messageBuffer.length} bytes)`);
          }
        });
      });
    });
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: string): void {
    try {
      // Parse message if it's a string
      let data: IPCMessage & Record<string, unknown>;
      try {
        // Sanitize control characters that may not be properly escaped by the DLL
        // This escapes all control chars (0x00-0x1F) as Unicode escape sequences
        // TODO: Fix the DLL
        const sanitized = message.trim().replace(/[\x00-\x1f]/g, (char) => {
          return '\\u' + ('0000' + char.charCodeAt(0).toString(16)).slice(-4);
        });
        if (sanitized === "") return;
        data = JSON.parse(sanitized);
      } catch (parseError) {
        logger.error('Failed to parse JSON message from DLL:' + parseError, message);
        return;
      }
      // Route based on message type
      switch (data.type) {
        case 'lua_response':
          this.handleResponse(data as unknown as APIResponse & { id: string });
          break;
        default:
          this.emit(data.type, data);
      }
    } catch (error) {
      logger.error('Failed to handle message:', error);
    }
  }

  /**
   * Handle response messages
   */
  private handleResponse(data: APIResponse & { id: string }): void {
    const request = this.pendingRequests.get(data.id);
    if (request) {
      clearTimeout(request.timeout);
      this.pendingRequests.delete(data.id);

      request.settle(data);
    } else {
      logger.warn('Received response for unknown request: ' + data.id);
    }
  }

  /**
   * Handle disconnection and attempt reconnection
   */
  private handleDisconnection(): void {
    this.connected = false;

    // Clear the message buffer on disconnection
    this.messageBuffer = '';

    // Reject all pending requests immediately when the DLL goes away.
    // Note: disconnect() also clears pending requests before triggering this handler,
    // so this loop is a no-op during graceful shutdown but handles unexpected disconnects.
    for (const [, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.settle(respondError(
        ErrorCode.DLL_DISCONNECTED,
        'Lost connection to DLL while waiting for a response'
      ));
    }
    this.pendingRequests.clear();

    if (this.shuttingDown) return;
    // Prevent parallel reconnection attempts
    if (this.reconnectTimer) return;

    // Attempt reconnection (infinite retries)
    this.reconnectAttempts++;
    const delay = Math.min(200 * Math.pow(1.5, this.reconnectAttempts), 5000); // Cap exponential backoff at 5000ms
    
    logger.debug(`Attempting reconnection ${this.reconnectAttempts} in ${delay}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined; // Clear the timer reference before attempting
      if (this.shuttingDown) return; // Don't reconnect if shutting down
      this.connect().catch((error) => {
        logger.error('Reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Send multiple messages to the DLL in batch
   *
   * @description
   * Sends multiple IPC messages to the DLL in a single batch operation.
   * This reduces IPC overhead compared to sending messages individually.
   * All messages are sent together using the "!@#$%^!" delimiter.
   *
   * @template T - Type of expected response data
   * @param messages - Array of IPC messages to send
   * @param timeout - Timeout in milliseconds for each message (default: 300000ms)
   * @returns Promise resolving to array of API responses, one per message
   *
   * @example
   * ```typescript
   * const messages = [
   *   { type: 'lua_call', function: 'Game.GetGameTurn', args: {} },
   *   { type: 'lua_call', function: 'Game.GetCurrentEra', args: {} }
   * ];
   * const responses = await dllConnector.sendBatch(messages);
   * console.log('Turn:', responses[0].result);
   * console.log('Era:', responses[1].result);
   * ```
   */
  public async sendBatch<T>(messages: IPCMessage[], timeout: number = 300000): Promise<APIResponse<T>[]> {
    if (!this.connected) {
      logger.warn('Cannot send messages, DLL is disconnected');
      return messages.map(() => respondError(ErrorCode.DLL_DISCONNECTED));
    }

    // Add IDs if not present and prepare batch data
    const messagesWithIds = messages.map(message => ({
      ...message,
      id: String(message.id || uuidv4())
    }));

    // Create promises for all messages
    const promises = messagesWithIds.map(messageWithId => {
      return new Promise<APIResponse<T>>((resolve) => {
        const request: PendingRequest<T> = {
          settle: resolve,
          timeout: guardTimeout(() => {
            if (this.pendingRequests.delete(messageWithId.id)) {
              logger.error('Message timeout: ' + messageWithId.id);
              resolve(respondError(ErrorCode.CALL_TIMEOUT));
            }
          }, timeout)
        };

        this.pendingRequests.set(messageWithId.id, request);
      });
    });

    // Send all messages as a batch
    try {
      const batchData = messagesWithIds.map(msg => JSON.stringify(msg)).join("!@#$%^!");
      ipc.of[config.gamepipe.id].emit(batchData + "!@#$%^!");
      logger.debug(`Sent batch of ${messagesWithIds.length} messages to DLL`);
      // Emit event for testing
      messagesWithIds.forEach(msg => this.emit('ipc_send', msg));
    } catch (error) {
      // Clear all pending requests and return error for all
      messagesWithIds.forEach(msg => {
        const request = this.pendingRequests.get(msg.id);
        if (request) {
          clearTimeout(request.timeout);
          this.pendingRequests.delete(msg.id);
        }
      });
      return messages.map(() => respondError(ErrorCode.NETWORK_ERROR));
    }

    return Promise.all(promises);
  }

  /**
   * Send a single message to the DLL
   *
   * @description
   * Sends a single IPC message to the DLL and waits for a response.
   * This is a convenience wrapper around sendBatch for single messages.
   *
   * @template T - Type of expected response data
   * @param message - IPC message to send
   * @param timeout - Timeout in milliseconds (default: 300000ms)
   * @returns Promise resolving to API response
   *
   * @example
   * ```typescript
   * const response = await dllConnector.send({
   *   type: 'lua_call',
   *   function: 'Game.GetGameTurn',
   *   args: {}
   * });
   * if (response.success) {
   *   console.log('Current turn:', response.result);
   * }
   * ```
   */
  public async send<T>(message: IPCMessage, timeout: number = 300000): Promise<APIResponse<T>> {
    const results = await this.sendBatch<T>([message], timeout);
    return results[0];
  }

  /**
   * Send a message without waiting for response
   */
  public sendNoWait(message: IPCMessage): APIResponse<any> {
    if (!this.connected) {
      logger.warn('Cannot send message, DLL is disconnected');
      return respondError(ErrorCode.DLL_DISCONNECTED);
    }

    try {
      ipc.of[config.gamepipe.id].emit(JSON.stringify(message) + "!@#$%^!");
      logger.debug('Sent no-wait message to DLL:', message);
      // Emit event for testing
      this.emit('ipc_send', message);
      return respondSuccess();
    } catch (error) {
      logger.error('Failed to send no-wait message:', error);
      return respondError(ErrorCode.NETWORK_ERROR);
    }
  }

  /**
   * Check if connected to DLL
   */
  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect from the DLL
   */
  public async disconnect(): Promise<void> {
    logger.info('Disconnecting from DLL');
    const wasConnected = this.connected;
    this.shuttingDown = true;
    this.connected = false;
    this.messageBuffer = '';

    // Clear pending requests
    for (const [, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.settle(respondError(
        ErrorCode.DLL_DISCONNECTED,
        'The service was shutting down'
      ));
    }
    this.pendingRequests.clear();

    // Avoid reconnection attempts during shutdown
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (!ipc.of[config.gamepipe.id]) {
      logger.info('Already disconnected from DLL');
      return;
    }

    if (!wasConnected) {
      ipc.disconnect(config.gamepipe.id);
      logger.info('Cleaned up disconnected DLL IPC client');
      return;
    }

    // Create a promise that resolves when disconnected event is emitted
    const disconnectedPromise = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // If disconnected event doesn't fire within 2 seconds, resolve anyway
        logger.warn('Disconnect timeout - resolving without event');
        resolve();
      }, 2000);

      this.once('disconnected', () => {
        clearTimeout(timeout);
        setTimeout(() => {
          resolve();
        }, 200);
      });
    });

    // Disconnect IPC
    if (ipc.of[config.gamepipe.id]) {
      ipc.disconnect(config.gamepipe.id);
    }

    // Wait for disconnected event or timeout
    await disconnectedPromise;
    logger.info('Disconnected from DLL successfully');
  }

  /**
   * Get connection statistics
   */
  public getStats(): {
    connected: boolean;
    pendingRequests: number;
    reconnectAttempts: number;
  } {
    return {
      connected: this.connected,
      pendingRequests: this.pendingRequests.size,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

// Export singleton instance
export const dllConnector = new DLLConnector();
export default dllConnector;
