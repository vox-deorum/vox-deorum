/**
 * Real-tier server setup. Every suite gets a real MCP server and client, while
 * the bridge and Civ database remain controlled test fixtures.
 */

import { afterAll, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPublishedUrl } from './fixtures/server-process.js';

process.env.NODE_ENV = 'test';

let mcpClient: Client;
let closeTransport: () => Promise<void>;
let shutdownFileDirectory: string | undefined;
let fixtureCleanup: (() => Promise<void>) | undefined;
let knowledgeFixtureCleanup: (() => Promise<void>) | undefined;
let originalShutdownFile: string | undefined;

beforeAll(async () => {
  const fixture = await import('./fixtures/game-database.js');
  const { gameDatabase, knowledgeManager } = await import('../src/server.js');
  fixtureCleanup = await fixture.configureGameDatabase(gameDatabase);
  const knowledgeFixture = await import('./fixtures/knowledge.js');
  knowledgeFixtureCleanup = await knowledgeFixture.configureKnowledgeManager(knowledgeManager);

  mcpClient = new Client({ name: 'test-client', version: '1.0.0' });
  switch (process.env.TEST_TRANSPORT ?? 'http') {
    case 'stdio': {
      const { config } = await import('../src/utils/config.js');
      config.transport.type = 'stdio';
      config.bridgeService.eventPipe.enabled = false;
      await mcpClient.connect(new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', 'tests/real-source-bootstrap.ts'],
        env: {
          ...process.env,
          MCP_TRANSPORT: 'stdio',
          TEST_TRANSPORT: 'stdio',
        },
        cwd: process.cwd(),
      }));
      closeTransport = () => mcpClient.close();
      break;
    }
    case 'http': {
      shutdownFileDirectory = await mkdtemp(join(tmpdir(), 'vox-mcp-real-'));
      const shutdownFile = join(shutdownFileDirectory, 'shutdown-url.txt');
      originalShutdownFile = process.env.MCP_SHUTDOWN_URL_FILE;
      process.env.MCP_SHUTDOWN_URL_FILE = shutdownFile;

      const { config } = await import('../src/utils/config.js');
      config.transport.type = 'http';
      config.transport.host = '127.0.0.1';
      config.transport.port = 0;
      config.bridgeService.eventPipe.enabled = false;
      const { startHttpServer } = await import('../src/http.js');
      const closeServer = await startHttpServer();
      closeTransport = async () => {
        await mcpClient.close();
        await closeServer();
      };

      // startHttpServer returns only after initialization, so the server is ready here.
      const shutdownUrl = await readPublishedUrl(shutdownFile);
      await mcpClient.connect(new StreamableHTTPClientTransport(
        new URL(shutdownUrl.replace('/shutdown', '/mcp'))
      ));
      break;
    }
    default:
      throw new Error(`Unknown transport type: ${process.env.TEST_TRANSPORT}`);
  }

  // Both transports finish initialization before accepting the client, so tools are listed at once.
  const { tools } = await mcpClient.listTools();
  if (!tools.some(tool => tool.name === 'calculator')) throw new Error('MCP server did not expose its tools');
}, 30000);

afterAll(async () => {
  try {
    await closeTransport?.();
  } finally {
    try {
      await knowledgeFixtureCleanup?.();
    } finally {
      try {
        await fixtureCleanup?.();
      } finally {
        if (originalShutdownFile === undefined) delete process.env.MCP_SHUTDOWN_URL_FILE;
        else process.env.MCP_SHUTDOWN_URL_FILE = originalShutdownFile;
        if (shutdownFileDirectory) {
          await rm(shutdownFileDirectory, { recursive: true, force: true });
        }
      }
    }
  }
});

export { mcpClient };
