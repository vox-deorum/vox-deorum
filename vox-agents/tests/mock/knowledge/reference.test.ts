/**
 * Tests for the game reference writer (src/knowledge/reference.ts): one set of detailed listing
 * calls for every store that lacks the reference, one commit per store only after every listing
 * succeeds, trimmed and ordered entries with the tooltip first, and skipping stores that already
 * hold it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorResult, installMockMcpClient, structuredResult } from '../../helpers/mock-mcp-client.js';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { hasGameReference, writeGameReference } from '../../../src/knowledge/reference.js';
import { WorkspaceStore } from '../../../src/utils/workspace/workspace-store.js';

const tools = ['get-technology', 'get-policy', 'get-building', 'get-unit'];

let mcp: ReturnType<typeof installMockMcpClient>;
let dir: string;
let stores: WorkspaceStore[];

/** Open a fresh seat store in the test folder. */
function openStore(name: string): WorkspaceStore {
  const store = WorkspaceStore.open(path.join(dir, `${name}.db`));
  stores.push(store);
  return store;
}

/** A stored file as UTF-8 text. */
function read(store: WorkspaceStore, storePath: string): string {
  return Buffer.from(store.readFile(storePath)!).toString('utf8');
}

beforeEach(() => {
  mcp = installMockMcpClient();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-reference-'));
  stores = [];
  for (const tool of tools) {
    mcp.respondWith(tool, structuredResult({ Count: 2, Items: [{ Type: `${tool}-A`, Name: 'Alpha', Cost: 10 }, { Type: `${tool}-B`, Name: 'Beta', Cost: 20 }] }));
  }
});

afterEach(() => {
  for (const store of stores) store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('writeGameReference', () => {
  it('should commit Markdown and JSON for every listing to each store with one call per tool', async () => {
    const [a, b] = [openStore('a'), openStore('b')];

    await expect(writeGameReference([a, b])).resolves.toBe(2);

    for (const tool of tools) {
      expect(mcp.calls(tool)).toHaveLength(1);
      expect(mcp.calls(tool)[0].args).toEqual({ MaxResults: 5000, Detailed: true });
    }
    for (const store of [a, b]) {
      const paths = [...store.manifest().keys()].filter((storePath) => storePath.startsWith('reference/'));
      expect(paths).toHaveLength(8);
      expect(store.history().at(-1)).toMatchObject({ kind: 'reference', turn: null, author: 'host' });
      const units = JSON.parse(read(store, 'reference/units.json'));
      expect(units.map((item: { Type: string }) => item.Type)).toEqual(['get-unit-A', 'get-unit-B']);
      expect(read(store, 'reference/technologies.md')).toContain('Alpha');
      expect(read(store, 'reference/technologies.md')).toContain('Beta');
    }
  });

  it('should put the tooltip first and the other fields after it', async () => {
    mcp.respondWith('get-policy', structuredResult({ Count: 1, Items: [{ Type: 'POLICY_ONLY', Name: 'Only', Help: 'Grants culture.', Branch: 'Tradition', PrereqPolicies: ['Root'] }] }));
    const store = openStore('a');

    await writeGameReference([store]);

    const policies = read(store, 'reference/policies.md');
    const section = policies.slice(policies.indexOf('## Only'));
    expect(section.indexOf('Grants culture.')).toBeGreaterThan(0);
    expect(section.indexOf('Grants culture.')).toBeLessThan(section.indexOf('Tradition'));
    expect(section).toContain('Root');
    expect(section).not.toMatch(/Help/);
  });

  it('should drop empty values and AI internals', async () => {
    mcp.respondWith('get-unit', structuredResult({ Count: 1, Items: [
      { Type: 'UNIT_WARRIOR', Name: 'Warrior', Help: 'Melee unit.', Combat: 8, RangedCombat: 0, Cost: 40, UniqueOf: null, AIType: 'Attack', Description: 'Advice', FreePromotions: [], RequiredResources: {}, PrereqTech: null },
    ] }));
    mcp.respondWith('get-building', structuredResult({ Count: 1, Items: [{ Type: 'BUILDING_PALACE', Name: 'Palace', Help: 'Capital.', Cost: -1, Maintenance: 0, IsWorldWonder: false, Strategy: 'Advice' }] }));
    const store = openStore('a');

    await writeGameReference([store]);

    expect(JSON.parse(read(store, 'reference/units.json'))).toEqual([{ Type: 'UNIT_WARRIOR', Name: 'Warrior', Help: 'Melee unit.', Combat: 8, Cost: 40 }]);
    expect(JSON.parse(read(store, 'reference/buildings.json'))).toEqual([{ Type: 'BUILDING_PALACE', Name: 'Palace', Help: 'Capital.' }]);
    expect(read(store, 'reference/units.md')).not.toMatch(/null|AIType|Advice/);
  });

  it('should order entries by era then cost, and policies by era, branch, then level', async () => {
    mcp.respondWith('get-technology', structuredResult({ Count: 4, Items: [
      { Type: 'TECH_C', Name: 'Classical Cheap', Era: 'Classical', Cost: 10 },
      { Type: 'TECH_B', Name: 'Ancient Dear', Era: 'Ancient', Cost: 90 },
      { Type: 'TECH_A', Name: 'Ancient Cheap', Era: 'Ancient', Cost: 20 },
      { Type: 'TECH_D', Name: 'Atomic', Era: 'Atomic', Cost: 5 },
    ] }));
    mcp.respondWith('get-policy', structuredResult({ Count: 3, Items: [
      { Type: 'P3', Name: 'Tradition Two', Era: 'Ancient', Branch: 'Tradition', Level: 2 },
      { Type: 'P2', Name: 'Tradition One', Era: 'Ancient', Branch: 'Tradition', Level: 1 },
      { Type: 'P1', Name: 'Authority One', Era: 'Ancient', Branch: 'Authority', Level: 1 },
    ] }));
    mcp.respondWith('get-unit', structuredResult({ Count: 2, Items: [
      { Type: 'UNIT_SPEARMAN', Name: 'Spearman', Era: 'Ancient', Cost: 60 },
      { Type: 'UNIT_WORKER', Name: 'Worker', Era: null, Cost: 70 },
    ] }));
    const store = openStore('a');

    await writeGameReference([store]);

    const headings = (file: string) => read(store, `reference/${file}.md`).split(/\r?\n/).filter((line) => line.startsWith('## '));
    expect(headings('technologies')).toEqual(['## Ancient Cheap', '## Ancient Dear', '## Classical Cheap', '## Atomic']);
    expect(headings('policies')).toEqual(['## Authority One', '## Tradition One', '## Tradition Two']);
    expect(headings('units')).toEqual(['## Worker', '## Spearman']);
    expect(JSON.parse(read(store, 'reference/technologies.json')).map((item: { Type: string }) => item.Type)).toEqual(['TECH_A', 'TECH_B', 'TECH_C', 'TECH_D']);
  });

  it.each([
    ['a returned Error field', structuredResult({ Count: 0, Items: [], Error: 'database not ready' })],
    ['an MCP error result', errorResult('tool failed')],
  ])('should commit nothing when a listing returns %s', async (_label, result) => {
    mcp.respondWith('get-building', result);
    const store = openStore('a');
    const head = store.head();

    await expect(writeGameReference([store])).rejects.toThrow();

    expect(store.head()).toBe(head);
    expect(hasGameReference(store)).toBe(false);
  });

  it('should commit nothing when a listing call throws', async () => {
    mcp.onTool('get-unit', () => { throw new Error('connection lost'); });
    const store = openStore('a');

    await expect(writeGameReference([store])).rejects.toThrow('connection lost');

    expect(hasGameReference(store)).toBe(false);
  });

  it('should write only the stores that lack the reference, and make no calls when none do', async () => {
    const [a, b] = [openStore('a'), openStore('b')];
    a.commit({ kind: 'reference', turn: null, author: 'host', changes: [{ path: 'reference/units.md', type: 'file', content: 'kept' }] });
    const headA = a.head();

    await expect(writeGameReference([a, b])).resolves.toBe(1);
    expect(a.head()).toBe(headA);
    expect(read(a, 'reference/units.md')).toBe('kept');
    expect(hasGameReference(b)).toBe(true);

    const calls = tools.map((tool) => mcp.calls(tool).length);
    await expect(writeGameReference([a, b])).resolves.toBe(0);
    expect(tools.map((tool) => mcp.calls(tool).length)).toEqual(calls);
  });
});
