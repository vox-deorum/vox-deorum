/**
 * Tests for the game reference writer (src/knowledge/reference.ts): one set of detailed listing
 * calls for stores that need a refresh, one commit per store after every listing succeeds,
 * trimmed and ordered entries with facts before help, and skipping complete current references.
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
      expect(paths).toHaveLength(9);
      expect(read(store, 'reference/.format-version').trim()).not.toBe('');
      expect(store.history().at(-1)).toMatchObject({ kind: 'reference', turn: null, author: 'host' });
      const units = JSON.parse(read(store, 'reference/units.json'));
      expect(units.map((item: { Name: string }) => item.Name)).toEqual(['Alpha', 'Beta']);
      expect(read(store, 'reference/units.json')).toMatch(/\n$/);
      expect(read(store, 'reference/technologies.md')).toContain('Alpha');
      expect(read(store, 'reference/technologies.md')).toContain('Beta');
    }
  });

  it('should put facts before a separate help section and order JSON keys for reading', async () => {
    mcp.respondWith('get-policy', structuredResult({ Count: 1, Items: [{ Type: 'POLICY_ONLY', Name: 'Only', Help: 'Grants culture.', Branch: 'Tradition', PrereqPolicies: ['Root'] }] }));
    const store = openStore('a');

    await writeGameReference([store]);

    const policies = read(store, 'reference/policies.md');
    const section = policies.slice(policies.indexOf('## Only'));
    expect(section.indexOf('Grants culture.')).toBeGreaterThan(0);
    expect(section.indexOf('Grants culture.')).toBeGreaterThan(section.indexOf('Tradition'));
    expect(section).toContain('Root');
    expect(section).toContain('### Help');
    expect(Object.keys(JSON.parse(read(store, 'reference/policies.json'))[0])).toEqual(['Name', 'Branch', 'PrereqPolicies', 'Help']);
  });

  it('should drop empty values and AI internals', async () => {
    mcp.respondWith('get-unit', structuredResult({ Count: 1, Items: [
      { Type: 'UNIT_WARRIOR', Name: 'Warrior', Help: 'Melee unit.', Combat: 8, RangedCombat: 0, Cost: 40, UniqueOf: null, AIType: 'Attack', Description: 'Advice', FreePromotions: [], RequiredResources: {}, PrereqTech: null },
    ] }));
    mcp.respondWith('get-building', structuredResult({ Count: 1, Items: [{ Type: 'BUILDING_PALACE', Name: 'Palace', Help: 'Capital.', Cost: -1, Maintenance: 0, IsWorldWonder: false, Strategy: 'Advice' }] }));
    const store = openStore('a');

    await writeGameReference([store]);

    expect(JSON.parse(read(store, 'reference/units.json'))).toEqual([{ Name: 'Warrior', Combat: 8, Cost: 40, Help: 'Melee unit.' }]);
    expect(JSON.parse(read(store, 'reference/buildings.json'))).toEqual([{ Name: 'Palace', Help: 'Capital.' }]);
    for (const file of ['units', 'buildings']) {
      expect(read(store, `reference/${file}.md`)).not.toMatch(/null|AIType|Advice|Type/);
    }
  });

  it('should keep the standard entry a unique unit or building replaces', async () => {
    mcp.respondWith('get-unit', structuredResult({ Items: [
      { Type: 'UNIT_JAGUAR', Name: 'Jaguar', UniqueOf: 'Aztec', Replaces: 'Warrior' },
      { Type: 'UNIT_WARRIOR', Name: 'Warrior', UniqueOf: null, Replaces: null },
    ] }));
    mcp.respondWith('get-building', structuredResult({ Items: [{ Type: 'BUILDING_MAYA_PYRAMID', Name: 'Pyramid', UniqueOf: 'Maya', Replaces: 'Temple' }] }));
    const store = openStore('a');

    await writeGameReference([store]);

    expect(JSON.parse(read(store, 'reference/units.json'))).toEqual([
      { Name: 'Jaguar', UniqueOf: 'Aztec', Replaces: 'Warrior' },
      { Name: 'Warrior' },
    ]);
    expect(JSON.parse(read(store, 'reference/buildings.json'))).toEqual([{ Name: 'Pyramid', UniqueOf: 'Maya', Replaces: 'Temple' }]);
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
    expect(JSON.parse(read(store, 'reference/technologies.json')).map((item: { Name: string }) => item.Name)).toEqual(['Ancient Cheap', 'Ancient Dear', 'Classical Cheap', 'Atomic']);
    expect(read(store, 'reference/policies.json')).not.toMatch(/"Type"|"Level"/);
    expect(read(store, 'reference/policies.md')).not.toMatch(/Type|Level/);
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

  it('should refresh legacy stores while leaving current stores untouched, then skip all calls', async () => {
    const [a, b] = [openStore('a'), openStore('b')];
    await writeGameReference([a]);
    b.commit({ kind: 'reference', turn: null, author: 'host', changes: [{ path: 'reference/units.md', type: 'file', content: 'legacy' }] });
    const headA = a.head();
    const legacyHead = b.head();
    expect(hasGameReference(a)).toBe(true);
    expect(hasGameReference(b)).toBe(false);

    await expect(writeGameReference([a, b])).resolves.toBe(1);
    expect(a.head()).toBe(headA);
    expect(read(b, 'reference/units.md')).not.toBe('legacy');
    expect(Buffer.from(b.readFile('reference/units.md', legacyHead)!).toString('utf8')).toBe('legacy');
    expect(hasGameReference(b)).toBe(true);

    const calls = tools.map((tool) => mcp.calls(tool).length);
    await expect(writeGameReference([a, b])).resolves.toBe(0);
    expect(tools.map((tool) => mcp.calls(tool).length)).toEqual(calls);
  });

  it.each(['missing file', 'old version'])('should refresh a reference with %s', async (reason) => {
    const store = openStore('a');
    await writeGameReference([store]);
    store.commit({ kind: 'reference', turn: null, author: 'host', changes: reason === 'missing file'
      ? [{ path: 'reference/policies.json', type: 'delete' }]
      : [{ path: 'reference/.format-version', type: 'file', content: 'old\n' }] });
    const head = store.head();

    await expect(writeGameReference([store])).resolves.toBe(1);

    expect(store.head()).not.toBe(head);
    expect(JSON.parse(read(store, 'reference/policies.json'))).toHaveLength(2);
    for (const tool of tools) expect(mcp.calls(tool)).toHaveLength(2);
  });

  it('should preserve legacy contents and history when a refresh fails', async () => {
    const store = openStore('a');
    store.commit({ kind: 'reference', turn: null, author: 'host', changes: [{ path: 'reference/units.md', type: 'file', content: 'legacy' }] });
    const head = store.head();
    mcp.failWith('get-unit', 'offline');

    await expect(writeGameReference([store])).rejects.toThrow('offline');

    expect(store.head()).toBe(head);
    expect(read(store, 'reference/units.md')).toBe('legacy');
    expect(store.readFile('reference/.format-version')).toBeUndefined();
  });

  it('should sort absent and sentinel costs as zero before removing internal fields', async () => {
    mcp.respondWith('get-building', structuredResult({ Items: [
      { Name: 'Zulu', Cost: -1 }, { Name: 'Alpha' }, { Name: 'Paid', Cost: 10 },
    ] }));
    const store = openStore('a');

    await writeGameReference([store]);

    expect(JSON.parse(read(store, 'reference/buildings.json'))).toEqual([
      { Name: 'Alpha' }, { Name: 'Zulu' }, { Name: 'Paid', Cost: 10 },
    ]);
  });

  it('should store empty listings as JSON arrays and Markdown category headings', async () => {
    for (const tool of tools) mcp.respondWith(tool, structuredResult({ Items: [] }));
    const store = openStore('a');

    await writeGameReference([store]);

    expect(read(store, 'reference/units.json')).toBe('[]\n');
    expect(read(store, 'reference/units.md').trim()).toBe('# Units');
    await expect(writeGameReference([store])).resolves.toBe(0);
  });
});
