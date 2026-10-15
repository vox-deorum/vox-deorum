/**
 * Test file to verify MCP Agents connectivity
 */

import { describe, it, expect } from 'vitest';
import { mcpClient } from '../setup.js';

describe('MCP Agents Connection', () => {
  it('should retrieve server capabilities', async () => {
    const capabilities = mcpClient.getServerCapabilities();
    expect(capabilities).toMatchObject({ tools: expect.any(Object) });
    expect(capabilities?.resources).toBeUndefined();
  });

  it('should list available tools', async () => {
    const tools = await mcpClient.listTools();
    const names = tools.tools.map(tool => tool.name);
    expect(names).toContain('calculator');
    expect(new Set(names).size).toBe(names.length);
  });
});
