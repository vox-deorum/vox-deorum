/**
 * Bridge Service - Main orchestration class for the Vox Deorum Bridge Service
 *
 * @module bridge-service/service
 *
 * @description
 * Main orchestrator that coordinates all Bridge Service components including
 * DLL connection, Lua manager, external function manager, and event pipe.
 * Follows the singleton pattern for consistent state management.
 */

import { createLogger } from './utils/logger.js';
import { dllConnector } from './services/dll-connector.js';
import { luaManager } from './services/lua-manager.js';
import { externalManager } from './services/external-manager.js';
import { eventPipe } from './services/event-pipe.js';
import { HealthCheckResponse } from './types/api.js';

const logger = createLogger('BridgeService');

/**
 * Bridge Service class for coordinating all service components
 *
 * @class BridgeService
 *
 * @description
 * Main orchestration class that manages the lifecycle of all Bridge Service components.
 * Coordinates startup, shutdown, and provides health/statistics monitoring.
 *
 * @example
 * ```typescript
 * // Service is exported as a singleton
 * import { bridgeService } from './service.js';
 *
 * // Start the service
 * await bridgeService.start();
 *
 * // Check health
 * const health = bridgeService.getHealthStatus();
 * console.log('Service running:', health.success);
 *
 * // Shutdown gracefully
 * await bridgeService.shutdown();
 * ```
 */
export class BridgeService {
  private startTime: Date;
  private isRunning: boolean = false;

  constructor() {
    this.startTime = new Date();
  }

  /**
   * Start the bridge service
   *
   * @description
   * Initializes and starts all Bridge Service components:
   * 1. Connects to the DLL via IPC
   * 2. Starts the event pipe (if enabled)
   *
   * @returns Promise that resolves when all components are started
   * @throws Error if DLL connection fails
   */
  public async start(): Promise<void> {
    logger.info('Starting Bridge Service...');
    this.isRunning = true;

    // Connect to DLL
    await dllConnector.connect();

    // Start event pipe if enabled
    await eventPipe.start();
  }

  /**
   * Stop the bridge service
   *
   * @description
   * Gracefully shuts down all Bridge Service components:
   * 1. Disconnects from the DLL
   * 2. Stops the event pipe
   *
   * @returns Promise that resolves when all components are stopped
   * @throws Error if shutdown encounters errors
   */
  public async shutdown(): Promise<void> {
    if (!this.isRunning) return;
    logger.info('Shutting down Bridge Service...');

    try {
      this.isRunning = false;
      // Disconnect from DLL (this will also clear any reconnection timers)
      await dllConnector.disconnect();

      // Stop event pipe
      await eventPipe.stop();
      logger.info('Bridge Service shut down successfully');
    } catch (error) {
      logger.error('Error during shutdown:', error);
      throw error;
    }
  }

  /**
   * Get service health status
   *
   * @description
   * Returns the current health status of the Bridge Service, including
   * DLL connection status, uptime, and version information.
   *
   * @returns Health check response object
   *
   * @example
   * ```typescript
   * const health = bridgeService.getHealthStatus();
   * if (health.success && health.dll_connected) {
   *   console.log('Service is healthy');
   *   console.log('Uptime:', health.uptime, 'seconds');
   * }
   * ```
   */
  public getHealthStatus(): HealthCheckResponse {
    const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
    const dllConnected = dllConnector.isConnected();
    
    return {
      success: this.isRunning && dllConnected,
      dll_connected: dllConnected,
      uptime,
      version: process.env.npm_package_version
    };
  }

  /**
   * Get detailed service statistics
   *
   * @description
   * Returns comprehensive statistics about all Bridge Service components including
   * DLL connection, Lua functions, external functions, event pipe, and memory usage.
   *
   * @returns Object containing detailed service statistics
   *
   * @example
   * ```typescript
   * const stats = bridgeService.getServiceStats();
   * console.log('DLL connected:', stats.dll.connected);
   * console.log('Lua functions:', stats.lua.registeredFunctions);
   * console.log('Memory usage:', stats.memory.used, 'MB');
   * ```
   */
  public getServiceStats(): {
    uptime: number;
    dll: {
      connected: boolean;
      pendingRequests: number;
      reconnectAttempts: number;
    };
    lua: {
      registeredFunctions: number;
    };
    external: {
      registeredFunctions: number;
      functionNames: string[];
    };
    eventPipe: {
      enabled: boolean;
      clients: number;
      pipeName: string;
    };
    memory: {
      used: number;
      total: number;
    };
  } {
    const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
    const memUsage = process.memoryUsage();
    
    return {
      uptime,
      dll: dllConnector.getStats(),
      lua: luaManager.getStats(),
      external: externalManager.getStats(),
      eventPipe: eventPipe.getStats(),
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        total: Math.round(memUsage.heapTotal / 1024 / 1024) // MB
      }
    };
  }

  /**
   * Check if service is running
   *
   * @description
   * Returns whether the Bridge Service is currently in a running state.
   *
   * @returns True if service is running, false otherwise
   */
  public isServiceRunning(): boolean {
    return this.isRunning;
  }

}

// Export singleton instance
export const bridgeService = new BridgeService();
export default bridgeService;