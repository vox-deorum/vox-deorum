/**
 * Message handling test - Tests for request/response flow and message communication
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DLLConnector } from '../../../src/services/dll-connector.js';
import { LuaCallMessage } from '../../../src/types/lua.js';
import { ErrorCode } from '../../../src/types/api.js';
import { logSuccess } from '../../test-utils/helpers.js';
import { restoreSharedMockDLL, startIsolatedMockDLL } from '../../test-utils/isolated-mock.js';
import { MockDLLServer } from '../../test-utils/mock-dll-server.js';

// Message handling and request/response flow
describe('Message Handling and Communication', () => {
  let connector: DLLConnector;
  let mockDLL: MockDLLServer;
  let originalPipeId: string;
  
  beforeEach(async () => {
    const isolated = await startIsolatedMockDLL('message-handling');
    mockDLL = isolated.mockDLL;
    originalPipeId = isolated.originalPipeId;
    connector = new DLLConnector();
    await expect(connector.connect()).resolves.toBe(true);
  });
  
  afterEach(async () => {
    if (connector && connector.isConnected()) {
      await connector.disconnect();
    }
    await restoreSharedMockDLL(mockDLL, originalPipeId);
  });

  // Successful message responses
  it('should handle successful message responses', async () => {
    const message: LuaCallMessage = {
      type: 'lua_call',
      function: 'GetPlayerName',
      args: []
    };
    
    const response = await connector.send(message);
    
    expect(response.success).toBe(true);
    expect(response.result).toBe('Mock Player');
  });
  
  // Message error handling
  it('should handle message errors', async () => {
    const message: LuaCallMessage = {
      type: 'lua_call',
      function: 'NonExistentFunction',
      args: []
    };
    
    const response = await connector.send(message);
    
    expect(response.success).toBe(false);
    expect(response.error).toBeDefined();
  });
  
  // Timeout handling and cleanup
  it('should handle message timeout', async () => {
    const message = {
      type: 'test_timeout',
      id: 'timeout-test'
    } as any;

    const response = await connector.send(message, 10); // 10ms timeout

    expect(response.success).toBe(false);
    expect(response.error?.code).toBe(ErrorCode.CALL_TIMEOUT);
    
    logSuccess('Message timeout handled correctly');
  });
  
  // SendNoWait message handling (connected and disconnected states)
  it('should handle sendNoWait messages in different connection states', async () => {
    // Test sendNoWait when connected
    const connectedMessage = {
      type: 'lua_call',
      id: 'no-wait-test'
    } as any;
    
    const connectedResponse = connector.sendNoWait(connectedMessage);
    expect(connectedResponse.success).toBe(true);
    logSuccess('No-wait message sent successfully when connected');
    
    // Test sendNoWait when disconnected
    await connector.disconnect();
    
    const disconnectedMessage = {
      type: 'lua_call',
      id: 'disconnected-test'
    } as any;
    
    const disconnectedResponse = connector.sendNoWait(disconnectedMessage);
    expect(disconnectedResponse.success).toBe(false);
    expect(disconnectedResponse.error?.code).toBe(ErrorCode.DLL_DISCONNECTED);
    logSuccess('SendNoWait correctly rejected when disconnected');
  });
});
