/**
 * Tests for VoxContext's MCP tool-registry path (src/infra/vox-context.ts):
 *   - registerTools(): fetches defs via mcpClient.getTools(), indexes them in
 *     mcpToolMap, wraps them into the executable `tools` set, and persists a
 *     metadata cache to disk.
 *   - loadToolCache(): the offline counterpart that rebuilds mcpToolMap from that
 *     cache file (used in -p mode when the MCP server is absent).
 *
 * Exercises the shared mcpClient fixture's getTools/setTools surface (no live
 * server) and stubs node:fs so the cache round-trip never touches the real
 * cache/mcp-tools.json that Oracle replay depends on.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import { installMockMcpClient } from '../helpers/mock-mcp-client.js';

vi.mock('../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { VoxContext } from '../../src/infra/vox-context.js';
import { AgentParameters } from '../../src/infra/vox-agent.js';

/** Two minimal MCP tool definitions; get-cities carries _meta to prove it round-trips. */
const TOOLS: MCPTool[] = [
  {
    name: 'get-cities',
    description: 'List cities',
    inputSchema: {
      type: 'object',
      properties: { PlayerID: { type: 'number' } },
      required: ['PlayerID'],
    },
    _meta: { markdownConfig: ['h1', 'h2'] },
  } as MCPTool,
  {
    name: 'get-players',
    description: 'List players',
    inputSchema: { type: 'object', properties: {} },
  } as MCPTool,
];

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('VoxContext.registerTools', () => {
  it('fetches MCP defs, indexes mcpToolMap, and wraps them into the tools set', async () => {
    // Stub the disk write so the real cache file is never clobbered.
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

    mcp.setTools(TOOLS);
    const ctx = new VoxContext<AgentParameters>();

    await ctx.registerTools();

    expect(mcp.getTools).toHaveBeenCalledTimes(1);
    // Raw defs are indexed by name for annotation lookups.
    expect(ctx.mcpToolMap.get('get-cities')).toEqual(TOOLS[0]);
    expect(ctx.mcpToolMap.get('get-players')).toEqual(TOOLS[1]);
    // Each tool becomes an executable entry in the tools set.
    expect(ctx.tools['get-cities']).toBeDefined();
    expect(ctx.tools['get-players']).toBeDefined();
    expect(typeof (ctx.tools['get-cities'] as any).execute).toBe('function');
  });

  it('persists a name/description/inputSchema/_meta projection to the cache file', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

    mcp.setTools(TOOLS);
    await new VoxContext<AgentParameters>().registerTools();

    expect(write).toHaveBeenCalledTimes(1);
    const [, payload] = write.mock.calls[0];
    const cached = JSON.parse(payload as string);
    expect(cached).toEqual([
      {
        name: 'get-cities',
        description: 'List cities',
        inputSchema: TOOLS[0].inputSchema,
        _meta: { markdownConfig: ['h1', 'h2'] },
      },
      {
        name: 'get-players',
        description: 'List players',
        inputSchema: TOOLS[1].inputSchema,
        _meta: undefined,
      },
    ]);
  });

  it('swallows a cache-write failure without failing registration', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('disk full');
    });

    mcp.setTools(TOOLS);
    const ctx = new VoxContext<AgentParameters>();

    await expect(ctx.registerTools()).resolves.toBeUndefined();
    // Tools are still registered in memory despite the cache failure.
    expect(ctx.tools['get-cities']).toBeDefined();
  });
});

describe('VoxContext.loadToolCache', () => {
  it('rebuilds mcpToolMap from the cached metadata when the file exists', () => {
    const cached = TOOLS.map((t) => ({ name: t.name, _meta: t._meta }));
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(cached));

    const ctx = new VoxContext<AgentParameters>();
    ctx.loadToolCache();

    expect(ctx.mcpToolMap.get('get-cities')?._meta).toEqual({ markdownConfig: ['h1', 'h2'] });
    expect(ctx.mcpToolMap.has('get-players')).toBe(true);
    // Offline path must not hit the MCP server.
    expect(mcp.getTools).not.toHaveBeenCalled();
  });

  it('leaves mcpToolMap empty when no cache file is present', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const ctx = new VoxContext<AgentParameters>();
    ctx.loadToolCache();

    expect(ctx.mcpToolMap.size).toBe(0);
  });
});
