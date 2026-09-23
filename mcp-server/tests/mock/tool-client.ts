/** MCP client harness for tools backed by an in-memory knowledge store. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ToolBase } from '../../src/tools/base.js';

/** Register a tool behind the MCP protocol, including its input validation. */
export async function connectToolClient(tool: ToolBase) {
  const server = new McpServer({ name: 'test-server', version: '1.0.0' });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  server.registerTool(tool.name, { inputSchema: tool.inputSchema.shape }, async args => ({
    content: [{ type: 'text' as const, text: JSON.stringify(await tool.execute(args)) }]
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    /** Invoke the tool through the client and decode its JSON response. */
    async call(args: Record<string, unknown>): Promise<any> {
      const result = await client.callTool({ name: tool.name, arguments: args });
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content.find(item => item.type === 'text')?.text ?? '';
      if (result.isError) throw new Error(text);
      return JSON.parse(text);
    },
    /** Close both sides of the MCP connection. */
    async close() {
      await client.close();
      await server.close();
    }
  };
}
