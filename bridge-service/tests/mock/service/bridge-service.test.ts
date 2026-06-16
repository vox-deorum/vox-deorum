import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import bridgeService from '../../../src/service.js';
import { dllConnector } from '../../../src/services/dll-connector.js';
import { pauseManager } from '../../../src/services/pause-manager.js';
import { waitForEvent } from '../../test-utils/helpers.js';
import { restoreSharedMockDLL, startIsolatedMockDLL } from '../../test-utils/isolated-mock.js';
import { MockDLLServer } from '../../test-utils/mock-dll-server.js';

describe('Bridge Service Orchestration', () => {
  let mockDLL: MockDLLServer;
  let originalPipeId: string;

  beforeEach(async () => {
    await bridgeService.shutdown();
    pauseManager.finalize();
    const isolated = await startIsolatedMockDLL('bridge-service');
    mockDLL = isolated.mockDLL;
    originalPipeId = isolated.originalPipeId;
  });

  afterEach(async () => {
    await bridgeService.shutdown();
    pauseManager.finalize();
    await restoreSharedMockDLL(mockDLL, originalPipeId);
  });

  it('starts and shuts down with health transitions', async () => {
    expect(bridgeService.isServiceRunning()).toBe(false);
    expect(bridgeService.getHealthStatus().success).toBe(false);

    const connected = dllConnector.isConnected() ? null : waitForEvent(dllConnector, 'connected', 5000);
    await bridgeService.start();
    if (connected) {
      await connected;
    }

    expect(bridgeService.isServiceRunning()).toBe(true);
    expect(bridgeService.getHealthStatus()).toEqual(
      expect.objectContaining({
        success: true,
        dll_connected: true
      })
    );

    await bridgeService.shutdown();

    expect(bridgeService.isServiceRunning()).toBe(false);
    expect(bridgeService.getHealthStatus().success).toBe(false);
  });

  it('handles duplicate shutdown calls without throwing', async () => {
    await bridgeService.start();
    await expect(bridgeService.shutdown()).resolves.toBeUndefined();
    await expect(bridgeService.shutdown()).resolves.toBeUndefined();
  });
});
