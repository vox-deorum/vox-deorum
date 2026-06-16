import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DLLConnector } from '../../../src/services/dll-connector.js';
import { delay, waitForEvent } from '../../test-utils/helpers.js';
import { restoreSharedMockDLL, startIsolatedMockDLL } from '../../test-utils/isolated-mock.js';
import { createMockDLLServer, MockDLLServer } from '../../test-utils/mock-dll-server.js';

describe('DLLConnector Buffering', () => {
  let connector: DLLConnector;
  let mockDLL: MockDLLServer;
  let originalPipeId: string;
  let pipeId: string;

  beforeEach(async () => {
    const isolated = await startIsolatedMockDLL('buffering');
    mockDLL = isolated.mockDLL;
    originalPipeId = isolated.originalPipeId;
    pipeId = isolated.pipeId;
    connector = new DLLConnector();
    await expect(connector.connect()).resolves.toBe(true);
  });

  afterEach(async () => {
    if (connector.isConnected()) {
      await connector.disconnect();
    }
    await restoreSharedMockDLL(mockDLL, originalPipeId);
  });

  it('reassembles partial response frames before parsing them', async () => {
    const pendingResponse = connector.send({ type: 'test_timeout', id: 'partial-frame' } as any, 1000);

    await mockDLL.sendRawChunks([
      '{"type":"lua_response","id":"partial-frame","success":true,"result":"hel',
      'lo"}!@#$%^!'
    ], 10);

    await expect(pendingResponse).resolves.toMatchObject({
      success: true,
      result: 'hello'
    });
  });

  it('handles multiple responses delivered in a single IPC chunk', async () => {
    const firstResponse = connector.send({ type: 'test_timeout', id: 'batch-one' } as any, 1000);
    const secondResponse = connector.send({ type: 'test_timeout', id: 'batch-two' } as any, 1000);

    mockDLL.sendRawData(
      '{"type":"lua_response","id":"batch-one","success":true,"result":1}!@#$%^!' +
      '{"type":"lua_response","id":"batch-two","success":true,"result":2}!@#$%^!'
    );

    await expect(firstResponse).resolves.toMatchObject({ success: true, result: 1 });
    await expect(secondResponse).resolves.toMatchObject({ success: true, result: 2 });
  });

  it('ignores invalid JSON without poisoning later valid responses', async () => {
    const pendingResponse = connector.send({ type: 'test_timeout', id: 'after-invalid' } as any, 1000);

    mockDLL.sendRawData('not-json!@#$%^!');
    await delay(20);
    mockDLL.sendRawData('{"type":"lua_response","id":"after-invalid","success":true,"result":"ok"}!@#$%^!');

    await expect(pendingResponse).resolves.toMatchObject({
      success: true,
      result: 'ok'
    });
  });

  it('ignores unknown response ids and still resolves known requests', async () => {
    const pendingResponse = connector.send({ type: 'test_timeout', id: 'known-response' } as any, 1000);

    mockDLL.sendRawData('{"type":"lua_response","id":"unknown-response","success":true,"result":"skip"}!@#$%^!');
    mockDLL.sendRawData('{"type":"lua_response","id":"known-response","success":true,"result":"done"}!@#$%^!');

    await expect(pendingResponse).resolves.toMatchObject({
      success: true,
      result: 'done'
    });
  });

  it('clears buffered partial data after a disconnect before parsing new responses', async () => {
    mockDLL.sendRawData('{"type":"lua_response","id":"stale"');

    const disconnected = waitForEvent(connector, 'disconnected', 5000);
    await mockDLL.stop();
    await disconnected;

    const reconnected = waitForEvent(connector, 'connected', 8000);
    mockDLL = await createMockDLLServer({
      id: pipeId,
      simulateDelay: true,
      responseDelay: 50,
      autoEvents: false
    });
    await reconnected;
    await waitForEvent(mockDLL, 'client_connected', 5000);
    await delay(50);

    const pendingResponse = connector.send({ type: 'test_timeout', id: 'after-reset' } as any, 1000);
    mockDLL.sendRawData('{"type":"lua_response","id":"after-reset","success":true,"result":"fresh"}!@#$%^!');

    await expect(pendingResponse).resolves.toMatchObject({
      success: true,
      result: 'fresh'
    });
  });
});
