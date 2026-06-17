/**
 * Stdio transport entry point for MCP server
 * Default mode for direct client connections via standard input/output
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MCPServer } from './server.js';
import { registerDefaultTools } from './tools/index.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('stdio');

/**
 * Start the MCP server with stdio transport
 * @param setupSignalHandlers - Whether to set up SIGINT/SIGTERM handlers (default: true)
 * @returns The transport instance for testing purposes
 */
export async function startStdioServer(setupSignalHandlers = true): Promise<() => Promise<void>> {
  const mcpServer = MCPServer.getInstance();
  const transport = new StdioServerTransport();
  const serverId = 'stdio-server';

  // Set up graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down stdio server gracefully');
    mcpServer.removeServer(serverId);
    await mcpServer.close();
    await transport.close();
  };

  if (setupSignalHandlers) {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGBREAK', shutdown);
  }

  try {
    await mcpServer.initialize();
    // Register the tool catalog (kept out of server.ts's import graph; see tools/index.ts)
    registerDefaultTools(mcpServer);
    // Create a new McpServer instance for stdio
    mcpServer.createServer(serverId);
    // Connect the server to the transport
    await mcpServer.connect(serverId, transport);
    
    logger.info('MCP server connected via stdio transport');
    return shutdown;
  } catch (error) {
    logger.error('Failed to start stdio server:', error);
    throw error;
  }
}