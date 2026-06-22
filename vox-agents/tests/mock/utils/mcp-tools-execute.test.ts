/**
 * Tests for the wrapMCPTool *execute* path (src/utils/tools/mcp-tools.ts) — autoComplete
 * injection, result normalization, markdown config, and error propagation. The pure
 * normalizeMCPToolResult is covered separately in mcp-tools.test.ts. Uses the shared
 * mcpClient fixture + a minimal stub VoxContext — no live server.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { installMockMcpClient, structuredResult } from '../../helpers/mock-mcp-client.js';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { wrapMCPTool } from '../../../src/utils/tools/mcp-tools.js';

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
});

/** Minimal stub VoxContext — only the fields wrapMCPTool touches. */
const context = { id: 'ctx-1', currentParameters: { turn: 4 }, timeoutRefresh: vi.fn() } as any;

/** Build an MCP tool definition; `_meta` carries autoComplete / markdownConfig. */
function mcpTool(meta?: Record<string, unknown>): Tool {
  return {
    name: 'get-cities',
    description: 'List cities',
    inputSchema: {
      type: 'object',
      properties: { PlayerID: { type: 'number' }, Filter: { type: 'string' } },
      required: ['PlayerID'],
    },
    ...(meta ? { _meta: meta } : {}),
  } as Tool;
}

/** Invoke the wrapped tool's execute with the AI SDK call options shape. */
function exec(tool: Tool, args: Record<string, unknown>, experimentalContext: Record<string, unknown> = {}) {
  const wrapped = wrapMCPTool(tool, context) as any;
  return wrapped.execute(args, { toolCallId: 't', messages: [], experimental_context: experimentalContext });
}

describe('wrapMCPTool execute', () => {
  it('injects autoComplete fields from the context and normalizes the result', async () => {
    mcp.respondWith('get-cities', structuredResult({ Name: 'Rome' }));

    const result = await exec(mcpTool({ autoComplete: ['PlayerID'] }), { Filter: 'capital' }, { playerID: 7 });

    expect(result).toEqual({ Name: 'Rome' });
    // PlayerID was filled in from experimental_context.playerID at call time.
    expect(mcp.calls('get-cities')[0].args).toEqual({ Filter: 'capital', PlayerID: 7 });
  });

  it('never clobbers an explicitly-passed arg with undefined', async () => {
    mcp.respondWith('get-cities', structuredResult({ ok: true }));

    await exec(mcpTool({ autoComplete: ['PlayerID'] }), { PlayerID: 99 }, /* no playerID */ {});

    expect(mcp.calls('get-cities')[0].args.PlayerID).toBe(99);
  });

  it('attaches _markdownConfig to record results when markdownConfig meta is present', async () => {
    mcp.respondWith('get-cities', structuredResult({ Name: 'Rome' }));

    const result = await exec(mcpTool({ markdownConfig: ['h1', 'h2'] }), { PlayerID: 1 });

    expect(result).toMatchObject({ Name: 'Rome' });
    expect((result as any)._markdownConfig).toEqual({ configs: [{ format: 'h1' }, { format: 'h2' }] });
  });

  it('propagates a tool error out of execute', async () => {
    mcp.failWith('get-cities', 'boom');
    await expect(exec(mcpTool(), { PlayerID: 1 })).rejects.toThrow('boom');
  });
});
