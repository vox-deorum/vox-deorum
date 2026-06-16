import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/index.js';
import config from '../../src/utils/config.js';
import { dllConnector } from '../../src/services/dll-connector.js';
import { TestServer } from '../test-utils/helpers.js';
import { MockExternalService } from '../test-utils/mock-external-service.js';
import { TEST_PORTS, TEST_URLS } from '../test-utils/constants.js';
import { registerExternalFunction, triggerExternalCall } from '../test-utils/external-helpers.js';

describe('Real Bridge Smoke', () => {
  const testServer = new TestServer();
  const mockExternalService = new MockExternalService(TEST_PORTS.MOCK_EXTERNAL_SERVICE);

  beforeAll(async () => {
    await mockExternalService.start();
    await testServer.start(app, config.rest.port, config.rest.host);
  });

  afterAll(async () => {
    await testServer.stop();
    await mockExternalService.stop();
  });

  it('connects to the live Civ DLL', () => {
    expect(dllConnector.isConnected()).toBe(true);
  });

  it('executes a deterministic Lua script through the live bridge', async () => {
    const response = await request(app)
      .post('/lua/execute')
      .send({ script: 'return 42' })
      .expect(200);

    expect(response.body.success).toBe(true);
  });

  it('registers and calls an external function through the live bridge', async () => {
    await registerExternalFunction(app, {
      name: 'realSmokeExternal',
      url: TEST_URLS.MOCK_SERVICE,
      async: false,
      timeout: 5000
    });

    const response = await triggerExternalCall(app, 'realSmokeExternal', 'smoke-payload', false);
    expect(response).toEqual(
      expect.objectContaining({
        success: true,
        result: 'smoke-payload'
      })
    );
  });
});
