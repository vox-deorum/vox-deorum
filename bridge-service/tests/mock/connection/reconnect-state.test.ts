import '../../../src/index.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import bridgeService from '../../../src/service.js';
import { dllConnector } from '../../../src/services/dll-connector.js';
import { externalManager } from '../../../src/services/external-manager.js';
import { pauseManager } from '../../../src/services/pause-manager.js';
import { delay, waitForEvent } from '../../test-utils/helpers.js';
import { restoreSharedMockDLL, startIsolatedMockDLL } from '../../test-utils/isolated-mock.js';
import { TEST_URLS } from '../../test-utils/constants.js';
import { MockDLLServer } from '../../test-utils/mock-dll-server.js';

describe('Reconnect State Restoration', () => {
  const sentMessages: any[] = [];
  let mockDLL: MockDLLServer;
  let originalPipeId: string;

  const captureHandler = (message: any) => {
    if (['external_register', 'pause_player'].includes(message.type)) {
      sentMessages.push(message);
    }
  };

  beforeAll(async () => {
    await bridgeService.shutdown();
    const isolated = await startIsolatedMockDLL('reconnect-state');
    mockDLL = isolated.mockDLL;
    originalPipeId = isolated.originalPipeId;
    dllConnector.on('ipc_send', captureHandler);
    await bridgeService.start();
  });

  afterEach(async () => {
    sentMessages.length = 0;
    pauseManager.finalize();

    const functions = externalManager.getFunctions().result?.functions || [];
    for (const func of functions) {
      await externalManager.unregisterFunction(func.name);
    }
  });

  afterAll(async () => {
    dllConnector.off('ipc_send', captureHandler);
    await bridgeService.shutdown();
    pauseManager.finalize();
    await restoreSharedMockDLL(mockDLL, originalPipeId);
  });

  it('re-registers external functions and clears paused players after DLL reconnect', async () => {
    await externalManager.registerFunction({
      name: 'reconnectFunction',
      url: TEST_URLS.MOCK_SERVICE,
      async: true
    });
    pauseManager.registerPausedPlayer(9);
    sentMessages.length = 0;

    await mockDLL.stop();
    await waitForDisconnectedState();

    expect(pauseManager.getPausedPlayers()).toEqual([]);

    const connected = waitForEvent(dllConnector, 'connected', 8000);
    await mockDLL.start();
    await connected;
    await delay(200);

    expect(sentMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'external_register', name: 'reconnectFunction', async: true })
      ])
    );
    expect(sentMessages.filter(message => message.type === 'pause_player')).toEqual([]);
  });
});

async function waitForDisconnectedState(timeoutMs: number = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (dllConnector.isConnected()) {
    if (Date.now() > deadline) {
      throw new Error('Timeout waiting for DLL disconnect state');
    }
    await delay(50);
  }
}
