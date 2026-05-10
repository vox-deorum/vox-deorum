/**
 * Common test helper functions for bridge-service tests
 */

import { expect } from 'vitest';
import request from 'supertest';
import { Application } from 'express';
import { setTimeout } from 'node:timers/promises';
import bridgeService from '../../src/service';
import { TEST_TIMEOUTS } from './constants';
import { pauseManager } from '../../src/services/pause-manager.js';

/**
 * Standard response assertions
 */
export function expectSuccessResponse(response: any, additionalChecks?: (response: any) => void) {
  expect(response.body.success).toBe(true);
  if (additionalChecks) {
    additionalChecks(response);
  }
}

export function expectErrorResponse(
  response: any, 
  errorCode: string, 
  messageContains?: string
) {
  expect(response.body.success).toBe(false);
  expect(response.body.error.code).toBe(errorCode);
  if (messageContains) {
    expect(response.body.error.message).toContain(messageContains);
  }
}

/**
 * Clean up all registered external functions
 */
export async function cleanupAllExternalFunctions(app: Application) {
  const response = await request(app).get('/external/functions');
  if (response.body.success && response.body.result.functions) {
    for (const func of response.body.result.functions) {
      await request(app).delete(`/external/register/${func.name}`);
    }
  }
}

/**
 * Wait for an event with timeout
 */
export function waitForEvent<T = any>(
  emitter: any,
  eventName: string,
  timeout: number = 5000,
  filter?: (data: any) => boolean
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      emitter.off(eventName, handler);
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);

    const handler = (data: any) => {
      if (!filter || filter(data)) {
        clearTimeout(timer);
        emitter.off(eventName, handler);
        resolve(data);
      }
    };

    emitter.on(eventName, handler);
  });
}

/**
 * Standard success log helper
 */
export function logSuccess(message: string): void {
  console.log(`✅ ${message}`);
}

/**
 * Delay helper for async operations
 */
export function delay(ms: number): Promise<void> {
  return setTimeout(ms);
}

/**
 * Test server lifecycle management
 */
export class TestServer {
  private server: any = null;

  async start(app: Application, port: number, host: string = '127.0.0.1'): Promise<void> {
    return new Promise(async (resolve) => {
      // Start the bridge service (DLL connection)
      if (!bridgeService.isServiceRunning()) {
        await bridgeService.start();
      }
      // Start the Express server
      this.server = app.listen(port, host, () => resolve());
      // Wait for server to be ready
      await delay(TEST_TIMEOUTS.VERY_SHORT);
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await bridgeService.shutdown();
      pauseManager.finalize();
      await new Promise<void>((resolve) => this.server.close(() => resolve()));
      this.server = null;
    }
  }

  isRunning(): boolean {
    return this.server !== null;
  }
}
