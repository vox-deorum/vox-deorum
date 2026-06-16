/**
 * SSE connection management test - Tests for Server-Sent Events client tracking and event broadcasting
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { EventSource } from 'eventsource';
import request from 'supertest';
import { app } from '../../../src/index.js';
import { getSSEStats } from '../../../src/routes/events.js';
import { dllConnector } from '../../../src/services/dll-connector.js';
import config from '../../../src/utils/config.js';
import { logSuccess, delay, TestServer, expectSuccessResponse } from '../../test-utils/helpers.js';
import { TEST_TIMEOUTS } from '../../test-utils/constants.js';

/**
 * Helper to wait for an SSE event with timeout
 */
function waitForSSEEvent(
  eventSource: EventSource, 
  eventType: string, 
  timeout: number = TEST_TIMEOUTS.DEFAULT
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventType}`));
    }, timeout);

    const handler = (event: MessageEvent) => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(event.data);
        resolve(data);
      } catch (error) {
        resolve(event.data);
      }
    };

    eventSource.addEventListener(eventType, handler, { once: true });
  });
}

/**
 * Helper to create an SSE client connection
 */
function createSSEClient(): EventSource {
  return new EventSource(`http://127.0.0.1:${config.rest.port}/events`, {
    withCredentials: false
  });
}

// SSE service functionality tests
describe('SSE Service', () => {
  const testServer = new TestServer();

  // Setup and teardown
  beforeAll(async () => {
    // Start the test server
    await testServer.start(app, config.rest.port, config.rest.host);
  });

  afterAll(async () => {
    // Close the test server
    await testServer.stop();
  });

  // Single SSE client connection
  describe('Single SSE Client Connection', () => {
    let client: EventSource;

    it('should establish SSE connection and receive connected event', async () => {
      client = createSSEClient();
      
      const connectedEvent = await waitForSSEEvent(client, 'connected');
      
      expect(connectedEvent).toHaveProperty('clientId');
      expect(connectedEvent).toHaveProperty('timestamp');
      expect(connectedEvent).toHaveProperty('message');
      expect(connectedEvent.message).toBe('Successfully connected to event stream');
      
      logSuccess('SSE connection established with connected event');
    });

    it('should handle client-initiated disconnection gracefully', async () => {
      const connectedStats = getSSEStats();
      
      // Close the connection
      client.close();
      
      // Wait for server to process disconnection
      await delay(TEST_TIMEOUTS.VERY_SHORT);
      
      const finalStats = getSSEStats();
      expect(finalStats.activeClients).toBe(connectedStats.activeClients - 1);
      
      logSuccess('Client disconnection handled properly');
    });
  });

  // Multiple concurrent SSE clients
  describe('Multiple SSE Client Connections', () => {
    let clients: EventSource[] = [];
    const clientCount = 5;

    afterAll(() => {
      // Clean up all clients
      clients.forEach(client => client.close());
      clients = [];
    });

    it('should handle multiple concurrent SSE connections', async () => {
      // Create multiple clients sequentially to avoid race conditions
      for (let i = 0; i < clientCount; i++) {
        const client = createSSEClient();
        clients.push(client);
        await waitForSSEEvent(client, 'connected');
      }
      
      // Check client count
      const stats = getSSEStats();
      expect(stats.activeClients).toBeGreaterThanOrEqual(clientCount);
      
      logSuccess(`Multiple SSE connections handled (${clientCount} clients)`);
    });

    it('should broadcast events to all connected clients', async () => {
      const eventPromises: Promise<any>[] = [];
      
      // Create multiple clients
      for (let i = 0; i < clientCount; i++) {
        // Set up listener for game event
        eventPromises.push(waitForSSEEvent(clients[i], 'message'));
      }
      
      // Emit a game event from DLL connector with id
      dllConnector.emit('game_event', {
        id: 1000001,
        event: 'test_event',
        payload: { test: 'data', value: 123 }
      });

      // All clients should receive the event
      const receivedEvents = await Promise.all(eventPromises);

      expect(receivedEvents).toHaveLength(clientCount);
      receivedEvents.forEach(event => {
        expect(event.id).toBe(1000001);
        expect(event.type).toBe('test_event');
        expect(event.payload).toEqual({ test: 'data', value: 123 });
      });
      
      logSuccess(`Event broadcast to all ${clientCount} clients`);
    });
  });

  // Integration with REST endpoints
  describe('Integration with REST Endpoints', () => {
    // Connect some SSE clients
    const clients: EventSource[] = [];
    
    beforeAll(async () => {
      for (let i = 0; i < 2; i++) {
        const client = createSSEClient();
        clients.push(client);
        await waitForSSEEvent(client, 'connected');
      }
    });

    afterAll(() => {
      // Close all SSE clients
      clients.forEach(client => client.close());
    });

    it('should report SSE stats via /stats endpoint', async () => {
      // Get stats via REST endpoint
      const response = await request(app)
        .get('/stats')
        .expect(200);
      
      expectSuccessResponse(response, (res) => {
        expect(res.body.result).toHaveProperty('sse');
        expect(res.body.result.sse.activeClients).toBe(2);
      });
      
      logSuccess('SSE stats available via REST endpoint');
    });
  });
});