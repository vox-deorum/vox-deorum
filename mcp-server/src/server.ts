/**
 * Main MCP server implementation with registration system
 * Singleton instance that manages resources and tools with self-registration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLogger } from './utils/logger.js';
import { config } from './utils/config.js';
import { wrapResults } from './utils/mcp.js';
import { ToolBase } from './tools/base.js';
import { getTools } from './tools/index.js';
import { BridgeManager } from './bridge/manager.js';
import { DatabaseManager } from './database/manager.js';
import { KnowledgeManager } from './knowledge/manager.js';
import { setTimeout } from 'node:timers/promises';
import * as z from "zod";
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const logger = createLogger('Server');

/**
 * MCP Server manager that handles resource and tool registration
 */
export class MCPServer {
  private static instance: MCPServer;
  private servers: Map<string, McpServer> = new Map();
  private initialized = false;
  private tools = new Map<string, ToolBase>();
  private bridgeManager: BridgeManager;
  private databaseManager: DatabaseManager;
  private knowledgeManager: KnowledgeManager;

  /**
   * Private constructor for MCPServer
   */
  private constructor() {
    // Initialize BridgeManager
    this.bridgeManager = new BridgeManager(config.bridge?.url);
    
    // Initialize DatabaseManager
    this.databaseManager = new DatabaseManager();
    
    // Initialize KnowledgeManager
    this.knowledgeManager = new KnowledgeManager();
  }

  /**
   * Get singleton instance of MCP server
   */
  public static getInstance(): MCPServer {
    if (!MCPServer.instance) {
      MCPServer.instance = new MCPServer();
    }
    return MCPServer.instance;
  }

  /**
   * Get all underlying McpServer instances
   */
  public getServers(): Map<string, McpServer> {
    return this.servers;
  }
  
  /**
   * Create a new McpServer instance with a unique ID
   */
  public createServer(id: string): McpServer {
    if (this.servers.has(id)) {
      logger.warn(`Server ${id} already exists, returning existing instance`);
      return this.servers.get(id)!;
    }
    
    const server = new McpServer({
      name: config.server.name,
      version: config.server.version,
    }, {
      capabilities: {
        
      }
    });
    
    // Register all existing tools with the new server
    this.tools.forEach(tool => {
      this.registerToolOnServer(server, tool);
    });
    
    this.servers.set(id, server);
    logger.info(`Created new McpServer instance: ${id}`);
    return server;
  }
  
  /**
   * Remove a McpServer instance
   */
  public removeServer(id: string): void {
    if (this.servers.delete(id)) {
      logger.info(`Removed McpServer instance: ${id}`);
    }
  }
  
  /**
   * Register a tool on a specific server
   */
  private registerToolOnServer(server: McpServer, tool: ToolBase): void {
    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema.shape,
        outputSchema: (tool.getOutputSchema() as z.ZodObject<z.ZodRawShape>).shape,
        annotations: tool.annotations,
        _meta: tool.metadata
      },
      (async (args: z.infer<typeof tool.inputSchema>) => {
        logger.warn(`Handling tool request ${tool.name}`, args);
        try {
          const results = await tool.execute(args);
          logger.warn(`Finishing tool request ${tool.name}`);
          // If tool already returns CallToolResult, use it directly
          if (results && typeof results === 'object' && 'content' in results) {
            return results;
          }
          // Otherwise wrap for backward compatibility
          return wrapResults(results);
        } catch (error: unknown) {
          var message = `Error executing tool ${tool.name}: ${error instanceof Error ? error.message : "unknown"}`;
          logger.error(message, error);
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: message,
              }
            ]
          }
        }
      }) as any
    );
  }

  /**
   * Register a tool with all servers
   */
  public registerTool(tool: ToolBase) {
    if (this.tools.has(tool.name)) {
      logger.warn(`Tool ${tool.name} already registered, replacing`);
    }

    // Register tool with all existing McpServers
    this.servers.forEach(server => {
      this.registerToolOnServer(server, tool);
    });

    this.tools.set(tool.name, tool);
    logger.info(`Registered tool: ${tool.name}`);
  }

  /**
   * Get a registered tool by name
   */
  public getTool(name: string): ToolBase | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  public getAllTools(): ToolBase[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get the BridgeManager instance
   */
  public getBridgeManager(): BridgeManager {
    return this.bridgeManager;
  }

  /**
   * Get the DatabaseManager instance
   */
  public getDatabaseManager(): DatabaseManager {
    return this.databaseManager;
  }

  /**
   * Get the KnowledgeManager instance
   */
  public getKnowledgeManager(): KnowledgeManager {
    return this.knowledgeManager;
  }

  private eventsForNotification = [
    "GameSwitched", "PlayerDoneTurn", "PlayerVictory",
    "DLLConnected", "DLLDisconnected",
    "PlayerPanelSwitch", "AnimationStarted",
  ];
  /**
   * Send a notification to all clients through MCP notification protocol.
   */
  public sendNotification(event: string, playerID: number, turn: number, latestID: number, param: Record<string, any> = {}) {
    if (this.eventsForNotification.indexOf(event) !== -1) {
      logger.info(`Sending server-side notification to ${this.servers.size} MCP clients about ${event} (Player ${playerID}) at turn ${turn}.`)
      // Send notification to all connected servers
      this.servers.forEach((server) => {
        this.sendNotificationTo(server, event, playerID, turn, latestID, param);
      });
    }
  }
  /**
   * Send a notification to a client through MCP notification protocol.
   */
  public sendNotificationTo(server: McpServer, event: string, playerID: number, turn: number, latestID: number, param: Record<string, any> = {}) {
    const rawServer = server.server;

    // Use the MCP notification protocol instead of elicitInput
    // We send a custom notification with our game event data
    rawServer.notification({
      method: "vox-deorum/game-event",
      params: {
        event: event,
        playerID: playerID,
        turn: turn,
        latestID: latestID,
        ...param
      }
    }).catch((_error: unknown) => { })
  }

  /**
   * One-off heartbeat ping. Distinct method from `vox-deorum/game-event` so
   * clients don't need to filter it — the MCP SDK silently drops notifications
   * without a registered handler. Used to reset undici's bodyTimeout on the
   * SSE channel before a long synchronous block (e.g. the victory archive
   * flow).
   */
  public sendHeartbeat(): void {
    logger.info(`Broadcasting heartbeat to ${this.servers.size} MCP clients.`);
    this.servers.forEach((server) => {
      server.server.notification({
        method: "vox-deorum/heartbeat",
        params: { ts: Date.now() }
      }).catch((_error: unknown) => { });
    });
  }

  /**
   * Initialize the server (can be extended in the future)
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing MCP server');
    
    // Initialize databases
    await this.databaseManager.initialize();
    await this.knowledgeManager.initialize();
    
    // Check Bridge Service health
    try {
      const health = await this.bridgeManager.checkHealth();
      logger.info('Bridge Service health:', health);
      
      // Connect to event stream (tries event pipe first if enabled, falls back to SSE)
      if (config.bridgeService.eventPipe?.enabled) {
        this.bridgeManager.connectEventPipe();
      } else {
        this.bridgeManager.connectSSE();
      }
    } catch (error: unknown) {
      throw new Error('Failed to connect to Bridge Service: ' + (error instanceof Error ? error.message : "unknown error"), { cause: error });
    }
    
    // Register all tools
    const tools = getTools();
    Object.values(tools).forEach(tool => this.registerTool(tool));
    
    this.initialized = true;
  }

  /**
   * Connect a specific server to a transport
   */
  public async connect(serverId: string, transport: StreamableHTTPServerTransport | StdioServerTransport): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }
    await server.connect(transport);

    // Send GameSwitched notification to the newly connected client
    const gameId = this.knowledgeManager.getGameId();
    if (this.bridgeManager.dllConnected && gameId !== "") {
      const lastId = parseInt(await this.knowledgeManager.getStore().getMetadata("lastID") ?? "-1");
      setTimeout(1000).then(() => {
        logger.info(`Sending GameSwitched notification to newly connected client for game ${gameId}`);
        this.sendNotificationTo(server, "GameSwitched", -1, this.knowledgeManager.getTurn(), lastId, { gameID: gameId });
      });
    }
  }

  /**
   * Shutdown the server
   */
  public async close(): Promise<void> {
    logger.info('Shutting down MCP server');
    
    // Shutdown databases
    await this.knowledgeManager.shutdown();
    await this.databaseManager.close();
    
    // Shutdown BridgeManager
    await this.bridgeManager.shutdown();
    
    this.initialized = false;
  }
}

/**
 * Export singleton bridge manager for easy access
 */
export const bridgeManager = MCPServer.getInstance().getBridgeManager();

/**
 * Export singleton database manager for easy access
 */
export const gameDatabase = MCPServer.getInstance().getDatabaseManager();

/**
 * Export singleton knowledge manager for easy access
 */
export const knowledgeManager = MCPServer.getInstance().getKnowledgeManager();