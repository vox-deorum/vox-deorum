/**
 * Connection lifecycle test - Tests for DLL connection establishment and disconnection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DLLConnector } from '../../../src/services/dll-connector.js';
import { LuaCallMessage } from '../../../src/types/lua.js';
import { logSuccess } from '../../test-utils/helpers.js';
import { restoreSharedMockDLL, startIsolatedMockDLL } from '../../test-utils/isolated-mock.js';
import { MockDLLServer } from '../../test-utils/mock-dll-server.js';

// DLLConnector connection lifecycle (connect/disconnect)
describe('DLLConnector Connection Lifecycle', () => {
  let connector: DLLConnector;
  let mockDLL: MockDLLServer;
  let originalPipeId: string;
  
  beforeEach(async () => {
    const isolated = await startIsolatedMockDLL('lifecycle');
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

  // Basic connection establishment and communication
  it('should establish connection to DLL server', async () => {
    const status = mockDLL.getStatus();
    expect(status.running).toBe(true);
    logSuccess(`Mock server status: running=${status.running}`);

    // Test initial state
    expect(connector.isConnected()).toBe(false);
    
    // Test connection event emission
    let connectedEventFired = false;
    connector.on('connected', () => {
      connectedEventFired = true;
    });
    
    // Attempt to connect, disconnect, and reconnect
    await expect(connector.connect()).resolves.toBe(true);
    logSuccess('Successfully connected to DLL server');

    expect(connectedEventFired).toBe(true);
    logSuccess('Connection event fired');

    await connector.disconnect();
    await expect(connector.connect()).resolves.toBe(true);
    logSuccess('Successfully reconnected to DLL server');
    
    // Test basic communication - send a Lua call
    const message: LuaCallMessage = {
      type: 'lua_call',
      function: 'GetPlayerName',
      args: []
    };
    
    const response = await connector.send(message);
    
    expect(response.success).toBe(true);
    expect(response.result).toBe('Mock Player');
    
    logSuccess('Basic communication test passed');
  });
  
  // Clean disconnection with event emission
  it('should handle clean disconnection', async () => {
    await expect(connector.connect()).resolves.toBe(true);
    
    // Test disconnection event emission
    let disconnectedEventFired = false;
    connector.on('disconnected', () => {
      disconnectedEventFired = true;
    });
    
    await connector.disconnect();
    expect(connector.isConnected()).toBe(false);
    
    // Give event time to fire
    expect(disconnectedEventFired).toBe(true);
    
    logSuccess('Connection closed cleanly');
  });
  
  // Idempotent connection and disconnection operations
  it('should handle idempotent connection and disconnection operations', async () => {
    // Test multiple connection attempts
      await expect(connector.connect()).resolves.toBe(true);
    
    // Second connection attempt should not cause issues
      await expect(connector.connect()).resolves.toBe(true);
    logSuccess('Multiple connection attempts handled gracefully');
    
    // Test multiple disconnection calls
    await connector.disconnect();
    expect(connector.isConnected()).toBe(false);
    
    // Second disconnect should not cause issues
    await connector.disconnect();
    expect(connector.isConnected()).toBe(false);
    logSuccess('Multiple disconnection calls handled gracefully');
  });
});
