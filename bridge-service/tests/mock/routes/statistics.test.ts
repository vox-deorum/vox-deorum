/**
 * Connection statistics test - Tests for connection monitoring and statistics tracking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DLLConnector } from '../../../src/services/dll-connector.js';
import { LuaCallMessage } from '../../../src/types/lua.js';
import bridgeService from '../../../src/service.js';
import { logSuccess } from '../../test-utils/helpers.js';
import { restoreSharedMockDLL, startIsolatedMockDLL } from '../../test-utils/isolated-mock.js';
import { MockDLLServer } from '../../test-utils/mock-dll-server.js';

// Connection statistics and monitoring
describe('Connection Statistics and Monitoring', () => {
  let connector: DLLConnector;
  let mockDLL: MockDLLServer;
  let originalPipeId: string;
  
  beforeEach(async () => {
    const isolated = await startIsolatedMockDLL('statistics-connector');
    mockDLL = isolated.mockDLL;
    originalPipeId = isolated.originalPipeId;
    connector = new DLLConnector();
  });
  
  afterEach(async () => {
    if (connector && connector.isConnected()) {
      await connector.disconnect();
    }
    await restoreSharedMockDLL(mockDLL, originalPipeId);
  });

  // Accurate connection statistics tracking
  it('should provide accurate connection statistics', async () => {
    // Test initial stats
    let stats = connector.getStats();
    expect(stats.connected).toBe(false);
    expect(stats.pendingRequests).toBe(0);
    expect(stats.reconnectAttempts).toBe(0);
    
    // Test stats after connection
    await expect(connector.connect()).resolves.toBe(true);
    stats = connector.getStats();
    expect(stats.connected).toBe(true);
    expect(stats.pendingRequests).toBe(0);
    expect(stats.reconnectAttempts).toBe(0);
    
    // Test stats after disconnect
    await connector.disconnect();
    stats = connector.getStats();
    expect(stats.connected).toBe(false);
    expect(stats.pendingRequests).toBe(0);
    
    logSuccess('Connection statistics working correctly');
  });
  
  // Pending request tracking
  it('should track pending requests', async () => {
    await expect(connector.connect()).resolves.toBe(true);

    const requestPromise = connector.send({
      type: 'lua_call',
      function: 'GetPlayerName',
      args: []
    } as LuaCallMessage);

    await requestPromise;

    const statsAfterResponse = connector.getStats();
    expect(statsAfterResponse.pendingRequests).toBe(0);
    
    logSuccess('Pending request tracking working');
  });
});


// Service-level connection coordination
describe('Service-Level Connection Management', () => {
  let mockDLL: MockDLLServer;
  let originalPipeId: string;

  beforeEach(async () => {
    await bridgeService.shutdown();
    const isolated = await startIsolatedMockDLL('statistics-service');
    mockDLL = isolated.mockDLL;
    originalPipeId = isolated.originalPipeId;
  });

  afterEach(async () => {
    await bridgeService.shutdown();
    await restoreSharedMockDLL(mockDLL, originalPipeId);
  });

  // Health status based on connection state
  it('should provide health status based on connection state', async () => {
    expect(bridgeService.getHealthStatus().success).toBe(false);

    await bridgeService.start();

    const healthStatus = bridgeService.getHealthStatus();
    expect(healthStatus).toEqual(
      expect.objectContaining({
        success: true,
        dll_connected: true
      })
    );
    expect(typeof healthStatus.uptime).toBe('number');
    expect(healthStatus.uptime).toBeGreaterThanOrEqual(0);
    
    logSuccess('Health status provides connection info');
  });
  
  // Detailed service statistics
  it('should provide detailed service statistics', async () => {
    await bridgeService.start();
    const stats = bridgeService.getServiceStats();
    
    expect(stats.dll).toEqual(
      expect.objectContaining({
        connected: true,
        pendingRequests: expect.any(Number),
        reconnectAttempts: expect.any(Number)
      })
    );
    expect(stats.eventPipe.pipeName).toBeDefined();
    
    logSuccess('Service statistics include connection details');
  });
});
