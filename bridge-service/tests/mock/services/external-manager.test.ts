import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { externalManager } from '../../../src/services/external-manager.js';
import { dllConnector } from '../../../src/services/dll-connector.js';
import { respondSuccess } from '../../../src/types/api.js';
import { TEST_URLS } from '../../test-utils/constants.js';

describe('External Manager', () => {
  const sentMessages: any[] = [];

  const captureHandler = (message: any) => {
    if (message.type === 'external_register') {
      sentMessages.push(message);
    }
  };

  beforeEach(() => {
    sentMessages.length = 0;
    dllConnector.on('ipc_send', captureHandler);
    vi.spyOn(dllConnector, 'sendNoWait').mockImplementation((message) => {
      dllConnector.emit('ipc_send', message);
      return respondSuccess();
    });
  });

  afterEach(async () => {
    dllConnector.off('ipc_send', captureHandler);
    vi.restoreAllMocks();

    const functions = externalManager.getFunctions().result?.functions || [];
    for (const func of functions) {
      await externalManager.unregisterFunction(func.name);
    }
  });

  it('applies the default timeout when one is not provided', async () => {
    const response = await externalManager.registerFunction({
      name: 'defaultTimeoutFunction',
      url: TEST_URLS.MOCK_SERVICE,
      async: true
    });

    expect(response.success).toBe(true);
    const functions = externalManager.getFunctions().result?.functions || [];
    expect(functions).toEqual([
      expect.objectContaining({
        name: 'defaultTimeoutFunction',
        timeout: 5000
      })
    ]);
  });

  it('rejects invalid registrations without mutating state', async () => {
    const response = await externalManager.registerFunction({
      name: '123-invalid',
      url: TEST_URLS.MOCK_SERVICE,
      async: true
    });

    expect(response.success).toBe(false);
    expect(externalManager.getFunctions().result?.functions).toEqual([]);
  });

  it('re-registers all known functions on demand', async () => {
    await externalManager.registerFunction({
      name: 'alphaFunction',
      url: TEST_URLS.MOCK_SERVICE,
      async: true
    });
    await externalManager.registerFunction({
      name: 'betaFunction',
      url: TEST_URLS.MOCK_SERVICE,
      async: false
    });

    sentMessages.length = 0;
    externalManager.reregisterAll();

    expect(sentMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'external_register', name: 'alphaFunction', async: true }),
        expect.objectContaining({ type: 'external_register', name: 'betaFunction', async: false })
      ])
    );
  });
});
