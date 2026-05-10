/**
 * Test setup configuration for MCP Server tests
 * Provides global test configuration and utilities
 */

import { beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { setTimeout } from 'node:timers/promises';
import { startHttpServer } from '../src/http.js';
import { MCPServer } from '../src/server.js';
import config from '../src/utils/config.js';

// Set test environment variables
process.env.NODE_ENV = 'test';

let server: MCPServer;
let closeTransport: () => Promise<void>;
let mcpClient: Client;

// Global test setup - start bridge service once for all tests
beforeAll(async () => {
  mcpClient = new Client({
    name: "test-client",
    version: "1.0.0"
  });
  // Start server and client with appropriate transport
  switch (process.env.TEST_TRANSPORT ?? "http") {
    case 'stdio':
      config.transport.type = 'stdio';
      await mcpClient.connect(new StdioClientTransport({
        command: 'node',
        args: ['dist/index.js']
      }));
      closeTransport = () => mcpClient.close();
      break;
    case 'http':
      closeTransport = await startHttpServer();
      // Connect MCP client
      await mcpClient.connect(new StreamableHTTPClientTransport(
        new URL(`http://${config.transport.host || '127.0.0.1'}:${config.transport.port || 4000}/mcp`)
      ));
      break;
    default:
      throw new Error(`Unknown transport type: ${process.env.TEST_TRANSPORT}`);
  }
  server = MCPServer.getInstance();
  // Delay 5s to allow loading database, etc.
  await setTimeout(5000);
}, 15000); // 15 second timeout for service startup

// Global test teardown - stop bridge service
afterAll(async () => {
  await closeTransport();
  // Delay 1s to allow cleanup
  await setTimeout(1000);
});

// Export utilities for tests
export {
  mcpClient
};
