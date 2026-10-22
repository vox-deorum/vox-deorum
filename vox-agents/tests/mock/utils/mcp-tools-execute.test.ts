/**
 * Tests for the wrapMCPTool *execute* path (src/utils/tools/mcp-tools.ts): autoComplete
 * injection, result normalization, markdown config, span status recording, and error
 * propagation. The pure normalizeMCPToolResult is covered separately in mcp-tools.test.ts.
 * Uses the shared mcpClient fixture, a fake OTel tracer, and a minimal stub VoxContext.
 * No live server.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { installMockMcpClient, structuredResult, errorResult } from '../../helpers/mock-mcp-client.js';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

/**
 * Minimal span recorder standing in for an OTel span, mirroring the pattern in
 * provider-tool-spans.test.ts plus the setAttributes/recordException calls
 * mcp-tools.ts makes on the span.
 */
class FakeSpan {
  attributes: Record<string, unknown> = {};
  status: { code: SpanStatusCode; message?: string } | undefined;
  ended = false;
  exceptions: unknown[] = [];
  constructor(public name: string, public options: any) {
    Object.assign(this.attributes, options?.attributes ?? {});
  }
  setAttribute(key: string, value: unknown) {
    this.attributes[key] = value;
    return this;
  }
  setAttributes(attrs: Record<string, unknown>) {
    Object.assign(this.attributes, attrs);
    return this;
  }
  recordException(error: unknown) {
    this.exceptions.push(error);
    return this;
  }
  setStatus(status: { code: SpanStatusCode; message?: string }) {
    this.status = status;
    return this;
  }
  end() {
    this.ended = true;
  }
}

// mcp-tools.ts grabs its tracer at module load (trace.getTracer('vox-tools')), so the
// whole '@opentelemetry/api' module is mocked before it is imported: everything stays
// real except trace.getTracer, which hands back a fake tracer recording each started span.
const otelSpans = vi.hoisted(() => [] as FakeSpan[]);

vi.mock('@opentelemetry/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/api')>();
  return {
    ...actual,
    trace: {
      ...actual.trace,
      getTracer: () => ({
        startSpan: (name: string, options: any) => {
          const span = new FakeSpan(name, options);
          otelSpans.push(span);
          return span;
        },
      }),
    },
  };
});

import { wrapMCPTool } from '../../../src/utils/tools/mcp-tools.js';

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
  otelSpans.length = 0;
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
function exec(tool: Tool, args: Record<string, unknown>, toolContext: Record<string, unknown> = {}) {
  const wrapped = wrapMCPTool(tool, context) as any;
  return wrapped.execute(args, { toolCallId: 't', messages: [], context: toolContext });
}

describe('wrapMCPTool execute', () => {
  it('filters autoComplete fields from the exposed schema without mutating the MCP definition', () => {
    const tool = mcpTool({ autoComplete: ['PlayerID'] });
    const originalSchema = structuredClone(tool.inputSchema);

    const wrapped = wrapMCPTool(tool, context) as any;
    const schema = wrapped.inputSchema.jsonSchema;

    expect(schema.properties).not.toHaveProperty('PlayerID');
    expect(schema.properties).toHaveProperty('Filter');
    expect(schema.required).toEqual([]);
    expect(tool.inputSchema).toEqual(originalSchema);
  });

  it('injects autoComplete fields from the context and normalizes the result', async () => {
    mcp.respondWith('get-cities', structuredResult({ Name: 'Rome' }));

    const result = await exec(mcpTool({ autoComplete: ['PlayerID'] }), { Filter: 'capital' }, { playerID: 7 });

    expect(result).toEqual({ Name: 'Rome' });
    // PlayerID was filled in from context.playerID at call time.
    expect(mcp.calls('get-cities')[0].args).toEqual({ Filter: 'capital', PlayerID: 7 });
  });

  it('does not mutate the caller input object when injecting autoComplete fields', async () => {
    mcp.respondWith('get-cities', structuredResult({ Name: 'Rome' }));

    // The conversation stores this exact object as the assistant tool-call
    // input, so the enrichment must land on a copy: replayed tool-call
    // arguments have to stay byte-identical to the model's call, which the
    // Codex proxy verifies against its stored pending continuation.
    const input = { Filter: 'capital' };
    await exec(mcpTool({ autoComplete: ['PlayerID', 'Turn'] }), input, { playerID: 7, turn: 4 });

    expect(input).toEqual({ Filter: 'capital' });
    expect(mcp.calls('get-cities')[0].args).toEqual({ Filter: 'capital', PlayerID: 7, Turn: 4 });
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

  it('should mark an isError MCP response as an ERROR span and still return the envelope', async () => {
    const envelope = errorResult('bad');
    mcp.respondWith('get-cities', envelope);

    const result = await exec(mcpTool(), { PlayerID: 1 });

    // The failure reaches the model as data; only the span records it as an error.
    expect(result).toEqual(envelope);
    expect(otelSpans).toHaveLength(1);
    expect(otelSpans[0].status?.code).toBe(SpanStatusCode.ERROR);
    expect(otelSpans[0].ended).toBe(true);
  });

  it('should mark a structured Success:false result as an ERROR span', async () => {
    mcp.respondWith('get-cities', structuredResult({ Success: false }));

    const result = await exec(mcpTool(), { PlayerID: 1 });

    expect(result).toEqual({ Success: false });
    expect(otelSpans).toHaveLength(1);
    expect(otelSpans[0].status?.code).toBe(SpanStatusCode.ERROR);
  });

  it('should mark a normal structured result as an OK span', async () => {
    mcp.respondWith('get-cities', structuredResult({ Name: 'Rome' }));

    const result = await exec(mcpTool(), { PlayerID: 1 });

    expect(result).toEqual({ Name: 'Rome' });
    expect(otelSpans).toHaveLength(1);
    expect(otelSpans[0].status?.code).toBe(SpanStatusCode.OK);
  });
});
