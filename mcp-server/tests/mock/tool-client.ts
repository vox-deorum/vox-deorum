/** MCP client harness for tools backed by an in-memory knowledge store. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ToolBase } from '../../src/tools/base.js';
import { registerToolOnServer } from '../../src/utils/mcp.js';
import * as z from 'zod';

const gameEventNotification = z.object({
  method: z.literal('vox-deorum/game-event'),
  params: z.object({
    event: z.string(),
    playerID: z.number(),
    turn: z.number(),
    latestID: z.number(),
    data: z.record(z.string(), z.unknown())
  })
});

/** Receive game notifications from the same server singleton used by the store. */
export async function connectNotificationClient() {
  const { MCPServer } = await import('../../src/server.js');
  const manager = MCPServer.getInstance();
  const id = `notification-test-${crypto.randomUUID()}`;
  const server = manager.createServer(id);
  const client = new Client({ name: 'notification-test-client', version: '1.0.0' });
  const notifications: Array<z.infer<typeof gameEventNotification>['params']> = [];
  client.setNotificationHandler(gameEventNotification, notification => {
    notifications.push(notification.params);
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    notifications,
    /** Close the connection and remove its server from the shared notification fanout. */
    async close() {
      await client.close();
      await server.close();
      manager.removeServer(id);
    }
  };
}

/** Register tools the way production does, so input and output schemas are both enforced. */
export async function connectToolClient(tool: ToolBase, ...otherTools: ToolBase[]) {
  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  for (const registeredTool of [tool, ...otherTools]) {
    registerToolOnServer(server, registeredTool);
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    /** Invoke the tool through the client and return its validated structured result. */
    async call(args: Record<string, unknown>, name = tool.name): Promise<any> {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.find(item => item.type === 'text')?.text ?? '';
      if (result.isError) throw new Error(text);
      // The in-memory transport passes objects by reference, so round-trip them like a real wire.
      if (result.structuredContent !== undefined) return JSON.parse(JSON.stringify(result.structuredContent));
      // Primitive results travel as plain text, such as "true" or a stored string value.
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
    /** Close both sides of the MCP connection. */
    async close() {
      await client.close();
      await server.close();
    }
  };
}

/** Call a tool once through a fresh MCP connection and close it afterwards. */
export async function callToolOnce(tool: ToolBase, args: Record<string, unknown>): Promise<any> {
  const client = await connectToolClient(tool);
  try {
    return await client.call(args);
  } finally {
    await client.close();
  }
}

/** A connected tool client returned by connectToolClient. */
export type ToolClient = Awaited<ReturnType<typeof connectToolClient>>;
