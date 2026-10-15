/** Verify the source server exposes the same tool result over real transports. */
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../../../src/utils/config.js';
import { isolateExternalManagers, readPublishedUrl } from '../../fixtures/server-process.js';

describe('source MCP transport contract', () => {
  it('returns the same calculator result through HTTP and stdio clients', async () => {
    const previous = {
      type: config.transport.type,
      host: config.transport.host,
      port: config.transport.port,
      eventPipeEnabled: config.bridgeService.eventPipe.enabled,
      shutdownFile: process.env.MCP_SHUTDOWN_URL_FILE,
    };
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'mcp-source-transport-'));
    const shutdownFile = path.join(tempDirectory, 'shutdown-url.txt');
    let closeHttpServer: (() => Promise<void>) | undefined;
    let httpClient: Client | undefined;
    let stdioClient: Client | undefined;

    // Isolate external services while preserving the production MCP server,
    // transport implementations, registration graph, and calculator tool.
    const restoreManagers = await isolateExternalManagers();

    try {
      config.transport.type = 'http';
      config.transport.host = '127.0.0.1';
      config.transport.port = 0;
      config.bridgeService.eventPipe.enabled = false;
      process.env.MCP_SHUTDOWN_URL_FILE = shutdownFile;

      // Import after setting the file path because the HTTP module snapshots it.
      const { startHttpServer } = await import('../../../src/http.js');
      closeHttpServer = await startHttpServer(false);
      const shutdownUrl = await readPublishedUrl(shutdownFile);
      httpClient = new Client({ name: 'http-contract-client', version: '1.0.0' });
      await httpClient.connect(new StreamableHTTPClientTransport(new URL(shutdownUrl.replace(/\/shutdown$/, '/mcp'))));

      const stdioBootstrap = fileURLToPath(new URL('../../fixtures/start-source-stdio.ts', import.meta.url));
      stdioClient = new Client({ name: 'stdio-contract-client', version: '1.0.0' });
      const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
      const stdioTransport = new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', stdioBootstrap],
        cwd: process.cwd(),
        env: environment,
      });
      await stdioClient.connect(stdioTransport);

      const [httpTools, stdioTools] = await Promise.all([httpClient.listTools(), stdioClient.listTools()]);
      const httpToolNames = httpTools.tools.map(tool => tool.name).sort();
      const stdioToolNames = stdioTools.tools.map(tool => tool.name).sort();
      expect(httpToolNames).toContain('calculator');
      expect(stdioToolNames).toEqual(httpToolNames);
      expect(httpClient.getServerCapabilities()?.resources).toBeUndefined();
      expect(stdioClient.getServerCapabilities()?.resources).toBeUndefined();

      const [httpResult, stdioResult] = await Promise.all([
        httpClient.callTool({ name: 'calculator', arguments: { Expression: '19 + 23' } }),
        stdioClient.callTool({ name: 'calculator', arguments: { Expression: '19 + 23' } }),
      ]);
      expect(httpResult.isError).not.toBe(true);
      expect(stdioResult.isError).not.toBe(true);
      expect(readToolValue(httpResult)).toEqual({ Result: 42 });
      expect(readToolValue(stdioResult)).toEqual({ Result: 42 });
      expect(readToolValue(httpResult)).toEqual(readToolValue(stdioResult));
    } finally {
      await stdioClient?.close();
      await httpClient?.close();
      await closeHttpServer?.();
      restoreManagers();
      config.transport.type = previous.type;
      config.transport.host = previous.host;
      config.transport.port = previous.port;
      config.bridgeService.eventPipe.enabled = previous.eventPipeEnabled;
      if (previous.shutdownFile === undefined) delete process.env.MCP_SHUTDOWN_URL_FILE;
      else process.env.MCP_SHUTDOWN_URL_FILE = previous.shutdownFile;
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }, 30000);
});

/** Decode the result object returned by a real MCP client call. */
function readToolValue(result: { content: Array<{ type: string; text?: string }>; structuredContent?: unknown }): unknown {
  if (result.structuredContent) return result.structuredContent;
  const text = result.content.find(item => item.type === 'text')?.text;
  if (!text) throw new Error('MCP tool response did not include a structured result');
  return JSON.parse(text);
}
