/**
 * Mock-tier unit tests for `src/oracle/utils/schema-tools.ts`.
 *
 * Covers the schema-only tool wrappers (autoComplete field stripping, optional
 * schema rewriter), in-place replacement of every `mcpToolMap` entry with a
 * non-executing schema-only tool, and loading the on-disk tool-definition cache
 * (success, missing-file, and malformed-JSON fallback to `false`).
 *
 * The cache lives at `cache/mcp-tools.json` relative to cwd, so cache tests run
 * inside a temp dir via `process.chdir`, restored in afterEach.
 *
 * Assertions target schema fields, non-execution behavior, and boolean returns —
 * never whole-string equality.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import {
  schemaOnlyTool,
  replaceToolsWithSchemaOnly,
  loadToolSchemaCache,
} from '../../../src/oracle/utils/schema-tools.js';
import { createFakeVoxContext } from '../../helpers/fake-vox-context.js';

/** Pull the underlying JSON Schema back out of an `ai` jsonSchema wrapper. */
function innerSchema(tool: any): any {
  return tool.inputSchema.jsonSchema;
}

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

describe('oracle schema-tools', () => {
  describe('schemaOnlyTool', () => {
    it('produces a dynamic tool whose execute never runs against MCP', async () => {
      const tool = schemaOnlyTool('set-flavors', baseMcpTool());
      expect(tool.type).toBe('dynamic');
      const result = await tool.execute({}, {} as any);
      expect(result).toMatchObject({ _oracle: true });
      expect(result.message).toContain('set-flavors');
      expect(result.message).toMatch(/replay/i);
    });

    it('uses the tool description', () => {
      const tool = schemaOnlyTool('set-flavors', baseMcpTool());
      expect(tool.description).toBe('Set strategic flavors');
    });

    it('falls back to a generated description when none is provided', () => {
      const tool = schemaOnlyTool('nameless', baseMcpTool({ description: undefined }));
      expect(tool.description).toContain('nameless');
    });

    it('strips _meta.autoComplete fields from properties and required', () => {
      const tool = schemaOnlyTool(
        'set-flavors',
        baseMcpTool({ _meta: { autoComplete: ['secret'] } })
      );
      const schema = innerSchema(tool);
      expect(schema.properties).toHaveProperty('GrandStrategy');
      expect(schema.properties).not.toHaveProperty('secret');
      expect(schema.required).toEqual(['GrandStrategy']);
    });

    it('leaves the schema intact when there is no autoComplete metadata', () => {
      const tool = schemaOnlyTool('set-flavors', baseMcpTool());
      const schema = innerSchema(tool);
      expect(Object.keys(schema.properties)).toEqual(['GrandStrategy', 'secret']);
      expect(schema.required).toEqual(['GrandStrategy', 'secret']);
    });

    it('applies an optional schema rewriter to description and inputSchema', () => {
      const rewriter = (json: string) => {
        const parsed = JSON.parse(json);
        return JSON.stringify({
          description: 'rewritten description',
          inputSchema: { ...parsed.inputSchema, title: 'Rewritten' },
        });
      };
      const tool = schemaOnlyTool('set-flavors', baseMcpTool(), rewriter);
      expect(tool.description).toBe('rewritten description');
      expect(innerSchema(tool).title).toBe('Rewritten');
    });

    it('applies autoComplete stripping before the rewriter sees the schema', () => {
      let seenProps: string[] = [];
      const rewriter = (json: string) => {
        const parsed = JSON.parse(json);
        seenProps = Object.keys(parsed.inputSchema.properties);
        return json;
      };
      schemaOnlyTool(
        'set-flavors',
        baseMcpTool({ _meta: { autoComplete: ['secret'] } }),
        rewriter
      );
      expect(seenProps).toEqual(['GrandStrategy']);
    });
  });

  describe('replaceToolsWithSchemaOnly', () => {
    it('replaces every mcpToolMap entry with a non-executing schema-only tool', async () => {
      const ctx = createFakeVoxContext();
      ctx.setMcpTools([
        baseMcpTool({ name: 'alpha' }),
        baseMcpTool({ name: 'beta', description: 'Beta tool' }),
      ]);

      replaceToolsWithSchemaOnly(ctx.asContext() as any);

      expect(Object.keys(ctx.tools).sort()).toEqual(['alpha', 'beta']);
      for (const name of ['alpha', 'beta']) {
        const tool = ctx.tools[name] as any;
        expect(tool.type).toBe('dynamic');
        const result = await tool.execute({}, {} as any);
        expect(result).toMatchObject({ _oracle: true });
        expect(result.message).toContain(name);
      }
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

  describe('loadToolSchemaCache', () => {
    let originalCwd: string;
    let tempDir: string;

    beforeEach(() => {
      originalCwd = process.cwd();
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-tools-'));
      process.chdir(tempDir);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function writeCache(content: string): void {
      fs.mkdirSync(path.join(tempDir, 'cache'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'cache', 'mcp-tools.json'), content);
    }

    it('loads cached tool definitions into mcpToolMap and returns true', () => {
      const cached: MCPTool[] = [
        baseMcpTool({ name: 'cached-a' }),
        baseMcpTool({ name: 'cached-b' }),
      ];
      writeCache(JSON.stringify(cached));
      const ctx = createFakeVoxContext();

      const ok = loadToolSchemaCache(ctx.asContext() as any);

      expect(ok).toBe(true);
      expect(ctx.mcpToolMap.size).toBe(2);
      expect(ctx.mcpToolMap.has('cached-a')).toBe(true);
      expect(ctx.mcpToolMap.get('cached-b')?.description).toBe('Set strategic flavors');
    });

    it('returns false when no cache file exists', () => {
      const ctx = createFakeVoxContext();
      const ok = loadToolSchemaCache(ctx.asContext() as any);
      expect(ok).toBe(false);
    });

    it('returns false when the cache file is malformed JSON', () => {
      writeCache('{ not valid json');
      const ctx = createFakeVoxContext();
      const ok = loadToolSchemaCache(ctx.asContext() as any);
      expect(ok).toBe(false);
    });
  });
});
