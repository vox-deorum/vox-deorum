/** The real MCP server becomes usable after a temporary bridge outage clears. */

import { afterEach, describe, expect, it, vi } from 'vitest';

const retrySleep = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock('node:timers/promises', () => ({ setTimeout: retrySleep }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  retrySleep.mockReset();
});

describe('MCP server startup readiness', () => {
  it('waits through bridge outages, rejects a terminal outage, then serves calculator calls', async () => {
    retrySleep.mockResolvedValue();
    const { DatabaseManager } = await import('../../../src/database/manager.js');
    const { KnowledgeManager } = await import('../../../src/knowledge/manager.js');
    const { BridgeManager } = await import('../../../src/bridge/manager.js');
    vi.spyOn(DatabaseManager.prototype, 'initialize').mockResolvedValue();
    vi.spyOn(KnowledgeManager.prototype, 'initialize').mockResolvedValue();
    vi.spyOn(BridgeManager.prototype as any, 'startQueueProcessorLoop').mockImplementation(() => undefined);
    vi.spyOn(BridgeManager.prototype, 'connectEventPipe').mockImplementation(() => undefined);
    vi.spyOn(BridgeManager.prototype, 'connectSSE').mockImplementation(() => undefined);
    const checkHealth = vi.spyOn(BridgeManager.prototype, 'checkHealth')
      .mockRejectedValue(new Error('bridge unavailable'));
    vi.spyOn(BridgeManager.prototype, 'shutdown').mockResolvedValue();
    const { MCPServer } = await import('../../../src/server.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const server = MCPServer.getInstance();
    const id = `startup-test-${crypto.randomUUID()}`;
    const client = new Client({ name: 'startup-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let mcpServer: ReturnType<typeof server.createServer> | undefined;
    let clientConnected = false;

    try {
      // A terminal bridge outage surfaces startup failure after its retry window.
      await expect(server.initialize()).rejects.toThrow();
      await server.close();

      let signalUnavailable!: () => void;
      let releaseRetry!: () => void;
      const unavailable = new Promise<void>(resolve => { signalUnavailable = resolve; });
      const retryGate = new Promise<void>(resolve => { releaseRetry = resolve; });
      let bridgeAvailable = false;
      checkHealth.mockImplementation(async () => {
        if (!bridgeAvailable) {
          signalUnavailable();
          throw new Error('bridge unavailable');
        }
        return { success: true, dll_connected: false, uptime: 0, version: 'fixture' };
      });
      retrySleep.mockImplementation(() => retryGate);

      let initializationSettled = false;
      const initialization = server.initialize().finally(() => { initializationSettled = true; });
      await unavailable;
      expect(initializationSettled).toBe(false);

      bridgeAvailable = true;
      releaseRetry();
      await initialization;
      const { registerDefaultTools } = await import('../../../src/tools/index.js');
      registerDefaultTools(server);
      mcpServer = server.createServer(id);
      await mcpServer.connect(serverTransport);
      await client.connect(clientTransport);
      clientConnected = true;
      const listed = await client.listTools();
      expect(listed.tools.map(tool => tool.name)).toContain('calculator');
      const result = await client.callTool({ name: 'calculator', arguments: { Expression: '19 + 23' } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ Result: 42 });
    } finally {
      if (clientConnected) await client.close();
      await mcpServer?.close();
      server.removeServer(id);
      await server.close();
    }
  });
});
