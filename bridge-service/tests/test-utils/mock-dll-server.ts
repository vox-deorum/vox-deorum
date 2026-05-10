/**
 * Mock DLL Server - Simulates the Community Patch DLL for testing
 * 
 * This server implements the same IPC protocol as the real DLL, allowing
 * the bridge service to be tested without the actual Civilization V game.
 */

import ipc from 'node-ipc';
import { EventEmitter } from 'events';
import { setTimeout } from 'node:timers/promises';
import { createLogger } from '../../src/utils/logger.js';
import {
  IPCMessage,
  GameEventMessage
} from '../../src/types/event.js';
import {
  LuaCallMessage,
  LuaResponseMessage,
  LuaRegisterMessage
} from '../../src/types/lua.js';
import {
  ExternalRegisterMessage,
  ExternalUnregisterMessage,
  ExternalCallMessage,
  ExternalResponseMessage
} from '../../src/types/external.js';

const logger = createLogger('MockDLL');

/**
 * Mock DLL Server configuration
 */
export interface MockDLLConfig {
  id: string;
  simulateDelay?: boolean;
  responseDelay?: number;
  autoEvents?: boolean;
  eventInterval?: number;
}

/**
 * Mock function configuration
 */
export interface MockFunction {
  name: string;
  handler: (args: any) => any;
  shouldSucceed?: boolean;
}

/**
 * Mock DLL Server class
 */
export class MockDLLServer extends EventEmitter {
  private config: MockDLLConfig;
  private isRunning: boolean = false;
  private eventTimer?: NodeJS.Timeout;
  private externalFunctions: Set<string> = new Set();
  private luaFunctions: Map<string, MockFunction> = new Map();
  private incomingBuffer: string = '';
  private connectedSockets: Set<any> = new Set();

  constructor(config: MockDLLConfig) {
    super();
    this.config = {
      simulateDelay: true,
      responseDelay: 50,
      autoEvents: false,
      eventInterval: 5000,
      ...config
    };
    this.setupIPC();
  }

  /**
   * Configure IPC settings
   */
  private setupIPC(): void {
    ipc.config.id = this.config.id;
    ipc.config.retry = 1500;
    ipc.config.maxRetries = false;
    ipc.config.silent = true;
    ipc.config.rawBuffer = true;
    ipc.config.encoding = 'utf8';
  }

  /**
   * Start the mock server
   */
  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isRunning) {
        resolve();
        return;
      }

      logger.info(`Starting mock DLL server with ID: ${this.config.id}`);

      ipc.serve(() => {
        logger.info('Mock DLL server started successfully');
        this.isRunning = true;
        this.setupMessageHandlers();
        
        if (this.config.autoEvents) {
          this.startAutoEvents();
        }
        
        this.emit('started');
        resolve();
      });

      ipc.server.on('error', (error: any) => {
        logger.error('Mock DLL server error:', error);
        reject(error);
      });

      ipc.server.start();
    });
  }

  /**
   * Setup message handlers
   */
  private setupMessageHandlers(): void {
    ipc.server.on('data', (data: any, socket: any) => {
      this.incomingBuffer += data.toString();
      const delimiter = '!@#$%^!';
      let delimiterIndex = this.incomingBuffer.indexOf(delimiter);

      while (delimiterIndex !== -1) {
        const message = this.incomingBuffer.slice(0, delimiterIndex);
        this.incomingBuffer = this.incomingBuffer.slice(delimiterIndex + delimiter.length);

        if (message.trim()) {
          logger.debug('Received message from bridge:', message);
          this.handleMessage(message, socket);
        }

        delimiterIndex = this.incomingBuffer.indexOf(delimiter);
      }
    });

    ipc.server.on('connect', (socket: any) => {
      this.connectedSockets.add(socket);
      logger.info('Bridge service connected to mock DLL');
      this.emit('client_connected', socket);
    });

    ipc.server.on('socket.disconnected', (socket: any) => {
      this.connectedSockets.delete(socket);
      logger.info('Bridge service disconnected from mock DLL');
      this.emit('client_disconnected', socket);
    });
  }

  /**
   * Handle incoming messages from bridge service
   */
  private async handleMessage(message: any, socket: any): Promise<void> {
    try {
      // Parse message if it's a string
      let data: IPCMessage;
      if (typeof message === 'string') {
        try {
          data = JSON.parse(message);
        } catch (parseError) {
          logger.error('Failed to parse JSON message:', parseError);
          return;
        }
      } else {
        data = message;
      }

      // Simulate processing delay
      if (this.config.simulateDelay && this.config.responseDelay) {
        await setTimeout(this.config.responseDelay);
      }

      // Route based on message type
      switch (data.type) {
        case 'lua_call':
          await this.handleLuaCall(data as LuaCallMessage, socket);
          break;
        case 'lua_execute':
          await this.handleLuaExecute(data as any, socket);
          break;
        case 'external_register':
          await this.handleExternalRegister(data as ExternalRegisterMessage, socket);
          break;
        case 'external_unregister':
          await this.handleExternalUnregister(data as ExternalUnregisterMessage, socket);
          break;
        case 'external_response':
          await this.handleExternalResponse(data as ExternalResponseMessage, socket);
          break;
        default:
          logger.warn('Unknown message type from bridge: ' + data.type);
      }
    } catch (error) {
      logger.error('Failed to handle message:', error);
    }
  }

  /**
   * Add a lua function for testing
   */
  public addLuaFunction(name: string, handler: (args: any) => any, shouldSucceed: boolean = true): void {
    this.luaFunctions.set(name, {
      name,
      handler,
      shouldSucceed
    });
    logger.debug(`Added lua function: ${name}`);
  }

  /**
   * Remove a lua function
   */
  public removeLuaFunction(name: string): void {
    this.luaFunctions.delete(name);
    logger.debug(`Removed lua function: ${name}`);
  }

  /**
   * Clear all lua functions
   */
  public clearLuaFunctions(): void {
    this.luaFunctions.clear();
    logger.debug('Cleared all lua functions');
  }

  /**
   * Handle Lua function calls
   */
  private async handleLuaCall(data: LuaCallMessage, _socket: any): Promise<void> {
    logger.debug('Processing Lua call:', data.function);

    let response: LuaResponseMessage;

    // First check if we have a registered mock function for this call
    const mockFunction = this.luaFunctions.get(data.function);
    if (mockFunction) {
      logger.debug(`Using registered mock function for: ${data.function}`);
      
      if (mockFunction.shouldSucceed !== false) {
        try {
          const result = mockFunction.handler(data.args);
          response = {
            type: 'lua_response',
            id: data.id!,
            success: true,
            result
          };
        } catch (error: any) {
          response = {
            type: 'lua_response',
            id: data.id!,
            success: false,
            error: {
              code: 'MOCK_ERROR',
              message: error.message || `Mock function error for ${data.function}`
            }
          };
        }
      } else {
        // Mock function configured to fail
        const errorMessage = mockFunction.handler(data.args);
        response = {
          type: 'lua_response',
          id: data.id!,
          success: false,
          error: {
            code: 'MOCK_ERROR',
            message: errorMessage || `Mock error for ${data.function}`
          }
        };
      }
    } else {
      // Fall back to default mock behavior
      const knownFunctions = new Set([
        'GetPlayerName',
        'GetCurrentTurn', 
        'GetCityCount',
        'GetGameState'
      ]);

      // Check if function exists in defaults
      if (!knownFunctions.has(data.function)) {
        // Return error for unknown functions
        response = {
          type: 'lua_response',
          id: data.id!,
          success: false,
          error: {
            code: 'FUNCTION_NOT_FOUND',
            message: `Function '${data.function}' is not available in the mock DLL`
          }
        };
      } else {
        // Mock different Lua functions with appropriate responses
        let result: any;
        switch (data.function) {
          case 'GetPlayerName':
            result = 'Mock Player';
            break;
          case 'GetCurrentTurn':
            result = Math.floor(Date.now() / 1000) % 500; // Mock turn number
            break;
          case 'GetCityCount':
            result = 3;
            break;
          case 'GetGameState':
            result = {
              turn: Math.floor(Date.now() / 1000) % 500,
              era: 'Classical Era',
              player: 'Mock Player',
              cities: 3,
              units: 8
            };
            break;
        }

        response = {
          type: 'lua_response',
          id: data.id!,
          success: true,
          result
        };
      }
    }

    this.sendMessage(response, _socket);
  }

  /**
   * Handle Lua script execution
   */
  private async handleLuaExecute(data: any, _socket: any): Promise<void> {
    logger.debug('Processing Lua script execution');

    let response: LuaResponseMessage;
    
    // Check if we have a mock function for ExecuteScript
    const mockFunction = this.luaFunctions.get('ExecuteScript');
    if (mockFunction) {
      logger.debug('Using registered mock function for script execution');
      
      if (mockFunction.shouldSucceed !== false) {
        try {
          const result = mockFunction.handler(data.script);
          response = {
            type: 'lua_response',
            id: data.id!,
            success: true,
            result
          };
        } catch (error: any) {
          response = {
            type: 'lua_response',
            id: data.id!,
            success: false,
            error: {
              code: 'SCRIPT_ERROR',
              message: error.message || 'Script execution failed'
            }
          };
        }
      } else {
        // Mock function configured to fail
        const errorMessage = mockFunction.handler(data.script);
        response = {
          type: 'lua_response',
          id: data.id!,
          success: false,
          error: {
            code: 'SCRIPT_ERROR',
            message: errorMessage || 'Script execution failed'
          }
        };
      }
    } else {
      // Fall back to default mock behavior
      try {
        // For testing, just return a mock result based on the script content
        let result: any = null;
        
        if (data.script) {
          if (data.script.includes('return 42')) {
            result = 42;
          } else if (data.script.includes('return 30') || data.script.includes('add(10, 20)')) {
            result = 30;
          } else if (data.script.includes('result = result +')) {
            // Sum calculation for long script
            result = 4950; // Sum of 0 to 99
          } else if (data.script.includes('Hello\\nWorld\\t')) {
            result = 'Hello\nWorld\t!';
          } else if (data.script.includes('local player = {') && data.script.includes('return player')) {
            // Object return value test
            result = {
              id: 1,
              name: 'TestPlayer',
              score: 100,
              active: true
            };
          } else if (data.script.includes('local players = {"Player1", "Player2", "Player3"}')) {
            // Array return value test
            result = ['Player1', 'Player2', 'Player3'];
          } else if (data.script.includes('local gameData = {') && data.script.includes('players = {')) {
            // Nested structure test
            result = {
              players: [
                { id: 1, name: 'Alice' },
                { id: 2, name: 'Bob' }
              ],
              settings: {
                difficulty: 'hard',
                mapSize: 'large'
              }
            };
          } else {
            // Default mock result
            result = 'Mock script executed';
          }
        }

        response = {
          type: 'lua_response',
          id: data.id!,
          success: true,
          result
        };
      } catch (error: any) {
        response = {
          type: 'lua_response',
          id: data.id!,
          success: false,
          error: {
            code: 'SCRIPT_ERROR',
            message: error.message || 'Script execution failed'
          }
        };
      }
    }

    this.sendMessage(response, _socket);
  }

  /**
   * Handle external function registration
   */
  private async handleExternalRegister(data: ExternalRegisterMessage, _socket: any): Promise<void> {
    logger.info(`Registering external function: ${data.name}`);
    this.externalFunctions.add(data.name);

    if (!data.id) {
      return;
    }

    const response: LuaResponseMessage = {
      type: 'lua_response',
      id: data.id!,
      success: true,
      result: { registered: true }
    };

    this.sendMessage(response, _socket);
  }

  /**
   * Handle external function unregistration
   */
  private async handleExternalUnregister(data: ExternalUnregisterMessage, _socket: any): Promise<void> {
    logger.info(`Unregistering external function: ${data.name}`);
    this.externalFunctions.delete(data.name);

    if (!data.id) {
      return;
    }

    const response: LuaResponseMessage = {
      type: 'lua_response',
      id: data.id!,
      success: true,
      result: { unregistered: true }
    };

    this.sendMessage(response, _socket);
  }

  /**
   * Handle external function response
   */
  private async handleExternalResponse(data: ExternalResponseMessage, _socket: any): Promise<void> {
    logger.debug('Received external function response:', data.id);
    // In a real scenario, this would complete a pending external call
    // For the mock, we just log it
  }

  /**
   * Send message to bridge service
   */
  private sendMessage(message: IPCMessage, socket?: any): void {
    try {
      const payload = JSON.stringify(message) + '!@#$%^!';
      if (socket) {
        ipc.server.emit(socket, payload);
      } else {
        ipc.server.broadcast(payload);
      }
      logger.debug('Sent message to bridge:', message);
    } catch (error) {
      logger.error('Failed to send message to bridge:', error);
    }
  }

  /**
   * Send raw data to the bridge service.
   */
  public sendRawData(raw: string, socket?: any): void {
    try {
      if (socket) {
        ipc.server.emit(socket, raw);
      } else {
        ipc.server.broadcast(raw);
      }
    } catch (error) {
      logger.error('Failed to send raw data to bridge:', error);
    }
  }

  /**
   * Send raw chunks to the bridge service to simulate partial frames.
   */
  public async sendRawChunks(chunks: string[], delayMs: number = 0): Promise<void> {
    for (const chunk of chunks) {
      this.sendRawData(chunk);
      if (delayMs > 0) {
        await setTimeout(delayMs);
      }
    }
  }

  /**
   * Simulate external function call
   */
  public simulateExternalCall(functionName: string, args: any = {}): void {
    if (!this.externalFunctions.has(functionName)) {
      logger.warn(`Cannot simulate call to unregistered function: ${functionName}`);
      return;
    }

    const message: ExternalCallMessage = {
      type: 'external_call',
      id: `mock_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      function: functionName,
      args,
      async: true
    };

    logger.info(`Simulating external call: ${functionName}`);
    this.sendMessage(message);
  }

  /**
   * Simulate game event
   */
  public simulateGameEvent(eventType: string, payload: any = {}): void {
    const message: GameEventMessage = {
      type: 'game_event',
      event: eventType,
      payload
    };

    logger.info(`Simulating game event: ${eventType}`);
    this.sendMessage(message);
  }

  /**
   * Simulate Lua register event
   */
  public simulateLuaRegister(functionName: string, description?: string): void {
    const message: LuaRegisterMessage = {
      type: 'lua_register',
      function: functionName,
      description
    };

    logger.info(`Simulating Lua register: ${functionName}`);
    this.sendMessage(message);
  }

  /**
   * Send a raw message to the bridge service (for testing purposes)
   */
  public sendRawMessage(message: IPCMessage): void {
    logger.info(`Sending raw message: ${message.type}`);
    this.sendMessage(message);
  }

  /**
   * Start automatic event generation
   */
  private startAutoEvents(): void {
    if (this.eventTimer) {
      clearInterval(this.eventTimer);
    }

    this.eventTimer = setInterval(() => {
      // Simulate random game events
      const events = [
        { type: 'turn_complete', payload: { turn: Math.floor(Date.now() / 1000) % 500 } },
        { type: 'city_founded', payload: { cityName: 'Mock City', player: 'Mock Player' } },
        { type: 'unit_moved', payload: { unitType: 'Warrior', position: [10, 15] } },
        { type: 'tech_researched', payload: { tech: 'Bronze Working', player: 'Mock Player' } }
      ];

      const randomEvent = events[Math.floor(Math.random() * events.length)];
      this.simulateGameEvent(randomEvent.type, randomEvent.payload);
    }, this.config.eventInterval);

    logger.info(`Started auto events with interval: ${this.config.eventInterval}ms`);
  }

  /**
   * Stop the mock server
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isRunning) {
        resolve();
        return;
      }

      logger.info('Stopping mock DLL server');

      if (this.eventTimer) {
        clearInterval(this.eventTimer);
        this.eventTimer = undefined;
      }

      for (const socket of this.connectedSockets) {
        try {
          if (typeof socket.end === 'function') {
            socket.end();
          }
          if (typeof socket.destroy === 'function') {
            socket.destroy();
          }
        } catch (error) {
          logger.warn('Failed to close mock DLL client socket:', error);
        }
      }
      this.connectedSockets.clear();

      ipc.server.stop();
      this.isRunning = false;
      this.incomingBuffer = '';
      this.externalFunctions.clear();
      this.luaFunctions.clear();
      
      this.emit('stopped');
      resolve();
    });
  }

  /**
   * Get server status
   */
  public getStatus(): {
    running: boolean;
    externalFunctions: string[];
    autoEvents: boolean;
  } {
    return {
      running: this.isRunning,
      externalFunctions: Array.from(this.externalFunctions),
      autoEvents: !!this.eventTimer
    };
  }
}

/**
 * Create and start a mock DLL server
 */
export async function createMockDLLServer(config: MockDLLConfig): Promise<MockDLLServer> {
  const server = new MockDLLServer(config);
  await server.start();
  return server;
}

/**
 * Default mock server factory for tests
 */
export async function createTestMockDLL(): Promise<MockDLLServer> {
  return createMockDLLServer({
    id: process.env.gamepipe_ID || 'vox-deorum-bridge',
    simulateDelay: true,
    responseDelay: 50,
    autoEvents: false
  });
}
