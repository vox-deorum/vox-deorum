/**
 * Mock-tier unit tests for `src/oracle/utils/schema-tools.ts`.
 *
 * Covers the schema-only tool wrappers (autoComplete field stripping, optional
 * schema rewriter), in-place replacement of every `mcpToolMap` entry with a
 * non-executing schema-only tool, and non-mutating autoComplete filtering.
 *
 * Assertions target schema fields and non-execution behavior, never whole-string equality.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import { replaceToolsWithSchemaOnly } from '../../../src/oracle/utils/schema-tools.js';
import { createFakeVoxContext } from '../../helpers/fake-vox-context.js';

/** Pull the underlying JSON Schema back out of an `ai` jsonSchema wrapper. */
function innerSchema(tool: any): any {
  return tool.inputSchema.jsonSchema;
}

/** Build an MCP definition with a visible argument and an optional auto-filled field. */
function baseMcpTool(overrides: Partial<MCPTool> & { _meta?: any } = {}): any {
  return {
    name: 'set-flavors',
    description: 'Set strategic flavors',
    inputSchema: {
      type: 'object',
      properties: {
        GrandStrategy: { type: 'string' },
        secret: { type: 'string' },
      },
      required: ['GrandStrategy', 'secret'],
    },
    ...overrides,
  };
}

/** Install one MCP definition through the Oracle replacement path and return its generated tool. */
function replaceOneTool(mcpTool: MCPTool, rewriter?: (json: string) => string): any {
  const ctx = createFakeVoxContext();
  ctx.setMcpTools([mcpTool]);
  replaceToolsWithSchemaOnly(ctx.asContext() as any, rewriter);
  return ctx.tools[mcpTool.name];
}

describe('oracle schema-tools', () => {
  it('preserves a tool description and schema when there is no autoComplete metadata', () => {
    const tool = replaceOneTool(baseMcpTool());
    const schema = innerSchema(tool);
    expect(tool.description).toBe('Set strategic flavors');
    expect(Object.keys(schema.properties)).toEqual(['GrandStrategy', 'secret']);
    expect(schema.required).toEqual(['GrandStrategy', 'secret']);
  });

  it('generates a description when none is provided', () => {
    const tool = replaceOneTool(baseMcpTool({ name: 'nameless', description: undefined }));
    expect(tool.description).toContain('nameless');
  });

  it('filters autoComplete fields without mutating the MCP definition', () => {
    const mcpTool = baseMcpTool({ _meta: { autoComplete: ['secret'] } });
    const originalSchema = structuredClone(mcpTool.inputSchema);
    const schema = innerSchema(replaceOneTool(mcpTool));
    expect(schema.properties).toHaveProperty('GrandStrategy');
    expect(schema.properties).not.toHaveProperty('secret');
    expect(schema.required).toEqual(['GrandStrategy']);
    expect(mcpTool.inputSchema).toEqual(originalSchema);
  });

  it('rewrites the filtered description and schema', () => {
    const rewriter = (json: string) => {
      const parsed = JSON.parse(json);
      return JSON.stringify({
        description: 'rewritten description',
        inputSchema: { ...parsed.inputSchema, title: 'Rewritten' },
      });
    };
    const tool = replaceOneTool(baseMcpTool(), rewriter);
    expect(tool.description).toBe('rewritten description');
    expect(innerSchema(tool).title).toBe('Rewritten');
  });

  it('filters autoComplete fields before the rewriter sees the schema', () => {
    let seenProps: string[] = [];
    const rewriter = (json: string) => {
      const parsed = JSON.parse(json);
      seenProps = Object.keys(parsed.inputSchema.properties);
      return json;
    };
    replaceOneTool(baseMcpTool({ _meta: { autoComplete: ['secret'] } }), rewriter);
    expect(seenProps).toEqual(['GrandStrategy']);
  });

  describe('replaceToolsWithSchemaOnly', () => {
    it('replaces every mcpToolMap entry with a non-executing schema-only tool', async () => {
      const ctx = createFakeVoxContext();
      const alphaExecutor = vi.fn();
      const betaExecutor = vi.fn();
      ctx.tools = {
        alpha: { execute: alphaExecutor } as any,
        beta: { execute: betaExecutor } as any,
      };
      ctx.setMcpTools([
        baseMcpTool({ name: 'alpha' }),
        baseMcpTool({ name: 'beta', description: 'Beta tool' }),
      ]);

      replaceToolsWithSchemaOnly(ctx.asContext() as any);

      expect(Object.keys(ctx.tools).sort()).toEqual(['alpha', 'beta']);
      for (const name of ['alpha', 'beta']) {
        const tool = ctx.tools[name] as any;
        expect(tool.type).toBe('dynamic');
        await tool.execute({}, {} as any);
      }
      expect(alphaExecutor).not.toHaveBeenCalled();
      expect(betaExecutor).not.toHaveBeenCalled();
      expect(ctx.callTool).not.toHaveBeenCalled();
    });

    it('applies autoComplete stripping and the rewriter to each tool', () => {
      const ctx = createFakeVoxContext();
      ctx.setMcpTools([baseMcpTool({ name: 'gamma', _meta: { autoComplete: ['secret'] } })]);
      const rewriter = (json: string) => {
        const parsed = JSON.parse(json);
        return JSON.stringify({
          description: 'rw',
          inputSchema: { ...parsed.inputSchema, marked: true },
        });
      };

      replaceToolsWithSchemaOnly(ctx.asContext() as any, rewriter);

      const tool = ctx.tools['gamma'] as any;
      expect(tool.description).toBe('rw');
      const schema = innerSchema(tool);
      expect(schema.properties).not.toHaveProperty('secret');
      expect(schema.marked).toBe(true);
    });

    it('clears existing tools when the mcpToolMap is empty', () => {
      const ctx = createFakeVoxContext();
      ctx.tools = { stale: {} as any };
      replaceToolsWithSchemaOnly(ctx.asContext() as any);
      expect(ctx.tools).toEqual({});
    });
  });

});
