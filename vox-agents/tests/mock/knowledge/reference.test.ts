/**
 * Tests for the game reference writer (src/knowledge/reference.ts): one set of detailed listing
 * calls for stores that need a refresh, one commit per store after every listing succeeds that
 * replaces the reference with a file pair for every category and era, entries trimmed and bucketed
 * by era (missing eras as ancient, unknown ones as other) without the `Era` field, per-bucket
 * order with facts before help, and skipping complete current references.
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
const categories = ['technologies', 'policies', 'buildings', 'units'];
const eras = ['ancient', 'classical', 'medieval', 'renaissance', 'industrial', 'modern', 'atomic', 'information', 'other'];
/** Every category and era file pair plus the format marker. */
const referenceFileCount = categories.length * eras.length * 2 + 1;

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

/** A JSON era file's entry names. */
function namesIn(store: WorkspaceStore, storePath: string): string[] {
  return (JSON.parse(read(store, storePath)) as { Name: string }[]).map((item) => item.Name);
}

/** Every reference path in a store's head version. */
function referencePaths(store: WorkspaceStore): string[] {
  return [...store.manifest().keys()].filter((storePath) => storePath.startsWith('reference/'));
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
  it('should commit every category and era file pair to each store with one call per tool', async () => {
    const [a, b] = [openStore('a'), openStore('b')];

    await expect(writeGameReference([a, b])).resolves.toBe(2);

    for (const tool of tools) {
      expect(mcp.calls(tool)).toHaveLength(1);
      expect(mcp.calls(tool)[0].args).toEqual({ MaxResults: 5000, Detailed: true });
    }
    for (const store of [a, b]) {
      expect(referencePaths(store)).toHaveLength(referenceFileCount);
      expect(read(store, 'reference/.format-version').trim()).not.toBe('');
      expect(store.history().at(-1)).toMatchObject({ kind: 'reference', turn: null, author: 'host' });
      expect(namesIn(store, 'reference/units/ancient.json')).toEqual(['Alpha', 'Beta']);
      expect(read(store, 'reference/units/ancient.json')).toMatch(/\n$/);
      expect(read(store, 'reference/technologies/ancient.md')).toContain('Alpha');
      expect(read(store, 'reference/technologies/ancient.md')).toContain('Beta');
      expect(read(store, 'reference/units/other.json')).toBe('[]\n');
    }
  });

  it('should generate every era file even when all listings are empty', async () => {
    for (const tool of tools) mcp.respondWith(tool, structuredResult({ Items: [] }));
    const store = openStore('a');

    await writeGameReference([store]);

    expect(referencePaths(store)).toHaveLength(referenceFileCount);
    for (const category of categories) {
      const title = category.charAt(0).toUpperCase() + category.slice(1);
      for (const era of eras) {
        expect(read(store, `reference/${category}/${era}.json`)).toBe('[]\n');
        expect(read(store, `reference/${category}/${era}.md`).trim()).toBe(`# ${title}`);
      }
    }
    await expect(writeGameReference([store])).resolves.toBe(0);
  });

  it('should put facts before a separate help section and order JSON keys for reading', async () => {
    mcp.respondWith('get-policy', structuredResult({ Count: 1, Items: [{ Type: 'POLICY_ONLY', Name: 'Only', Help: 'Grants culture.', Branch: 'Tradition', PrereqPolicies: ['Root'] }] }));
    const store = openStore('a');

    await writeGameReference([store]);

    const policies = read(store, 'reference/policies/ancient.md');
    const section = policies.slice(policies.indexOf('## Only'));
    expect(section.indexOf('Grants culture.')).toBeGreaterThan(0);
    expect(section.indexOf('Grants culture.')).toBeGreaterThan(section.indexOf('Tradition'));
    expect(section).toContain('Root');
    expect(section).toContain('### Help');
    expect(Object.keys(JSON.parse(read(store, 'reference/policies/ancient.json'))[0])).toEqual(['Name', 'Branch', 'PrereqPolicies', 'Help']);
  });

  it('should drop empty values and AI internals', async () => {
    mcp.respondWith('get-unit', structuredResult({ Count: 1, Items: [
      { Type: 'UNIT_WARRIOR', Name: 'Warrior', Help: 'Melee unit.', Combat: 8, RangedCombat: 0, Cost: 40, UniqueOf: null, AIType: 'Attack', Description: 'Advice', FreePromotions: [], RequiredResources: {}, PrereqTech: null },
    ] }));
    mcp.respondWith('get-building', structuredResult({ Count: 1, Items: [{ Type: 'BUILDING_PALACE', Name: 'Palace', Help: 'Capital.', Cost: -1, Maintenance: 0, IsWorldWonder: false, Strategy: 'Advice' }] }));
    const store = openStore('a');

    await writeGameReference([store]);

    expect(JSON.parse(read(store, 'reference/units/ancient.json'))).toEqual([{ Name: 'Warrior', Combat: 8, Cost: 40, Help: 'Melee unit.' }]);
    expect(JSON.parse(read(store, 'reference/buildings/ancient.json'))).toEqual([{ Name: 'Palace', Help: 'Capital.' }]);
    for (const file of ['units', 'buildings']) {
      expect(read(store, `reference/${file}/ancient.md`)).not.toMatch(/null|AIType|Advice|Type/);
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

    expect(JSON.parse(read(store, 'reference/units/ancient.json'))).toEqual([
      { Name: 'Jaguar', UniqueOf: 'Aztec', Replaces: 'Warrior' },
      { Name: 'Warrior' },
    ]);
    expect(JSON.parse(read(store, 'reference/buildings/ancient.json'))).toEqual([{ Name: 'Pyramid', UniqueOf: 'Maya', Replaces: 'Temple' }]);
  });

  it('should order entries within each era bucket, title files by category only, and remove the era', async () => {
    mcp.respondWith('get-technology', structuredResult({ Count: 5, Items: [
      { Type: 'T1', Name: 'Wheel', Era: 'Ancient', Cost: 20 },
      { Type: 'T2', Name: 'Agriculture', Era: 'Ancient', Cost: 20 },
      { Type: 'T3', Name: 'Bronze Working', Era: 'Ancient', Cost: 90 },
      { Type: 'T4', Name: 'Architecture', Era: 'Classical', Cost: 10 },
      { Type: 'T5', Name: 'Smithing', Era: 'Medieval', Cost: 40 },
    ] }));
    mcp.respondWith('get-policy', structuredResult({ Count: 4, Items: [
      { Type: 'P3', Name: 'Tradition Two', Era: 'Ancient', Branch: 'Tradition', Level: 2 },
      { Type: 'P2', Name: 'Tradition One', Era: 'Ancient', Branch: 'Tradition', Level: 1 },
      { Type: 'P1', Name: 'Authority One', Era: 'Ancient', Branch: 'Authority', Level: 1 },
      { Type: 'P4', Name: 'Centralization', Era: 'Classical', Branch: 'Liberty', Level: 1 },
    ] }));
    mcp.respondWith('get-unit', structuredResult({ Count: 3, Items: [
      { Type: 'U1', Name: 'Spearman', Era: 'Ancient', Cost: 60 },
      { Type: 'U2', Name: 'Chariot', Era: 'Ancient', Cost: 60 },
      { Type: 'U3', Name: 'Worker', Era: null, Cost: 70 },
    ] }));
    const store = openStore('a');

    await writeGameReference([store]);

    const headings = (file: string) => read(store, `reference/${file}.md`).split(/\r?\n/).filter((line) => line.startsWith('## '));
    expect(headings('technologies/ancient')).toEqual(['## Agriculture', '## Wheel', '## Bronze Working']);
    expect(headings('technologies/classical')).toEqual(['## Architecture']);
    expect(headings('technologies/medieval')).toEqual(['## Smithing']);
    expect(namesIn(store, 'reference/technologies/ancient.json')).toEqual(['Agriculture', 'Wheel', 'Bronze Working']);
    expect(headings('policies/ancient')).toEqual(['## Authority One', '## Tradition One', '## Tradition Two']);
    expect(headings('policies/classical')).toEqual(['## Centralization']);
    expect(headings('units/ancient')).toEqual(['## Chariot', '## Spearman', '## Worker']);
    expect(read(store, 'reference/policies/ancient.json')).not.toMatch(/"Type"|"Level"/);
    expect(read(store, 'reference/policies/ancient.md')).not.toMatch(/Type|Level/);
    expect(read(store, 'reference/technologies/ancient.md')).not.toMatch(/Era/);
    for (const era of ['ancient', 'classical', 'medieval']) {
      expect(read(store, `reference/technologies/${era}.json`)).not.toMatch(/"Era"/);
    }
    expect(read(store, 'reference/technologies/ancient.md')).toMatch(/^# Technologies$/m);
  });

  it('should file missing eras as ancient and unknown eras as other, keeping every entry', async () => {
    mcp.respondWith('get-unit', structuredResult({ Items: [
      { Type: 'U1', Name: 'Warrior', Era: null },
      { Type: 'U2', Name: 'Settler' },
      { Type: 'U3', Name: 'Slinger', Era: 'Ancient' },
      { Type: 'U4', Name: 'Alien', Era: 'Future' },
    ] }));
    const store = openStore('a');

    await writeGameReference([store]);

    expect(namesIn(store, 'reference/units/ancient.json')).toEqual(['Settler', 'Slinger', 'Warrior']);
    expect(namesIn(store, 'reference/units/other.json')).toEqual(['Alien']);
    expect(read(store, 'reference/units/other.json')).not.toMatch(/"Era"/);
    const total = eras.reduce((sum, era) => sum + namesIn(store, `reference/units/${era}.json`).length, 0);
    expect(total).toBe(4);
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

  it('should replace a stale reference and keep its history readable, then skip all calls', async () => {
    const [a, b] = [openStore('a'), openStore('b')];
    await writeGameReference([a]);
    b.commit({ kind: 'reference', turn: null, author: 'host', changes: [
      { path: 'reference/units.md', type: 'file', content: 'stale' },
      { path: 'reference/technologies.json', type: 'file', content: '[]' },
      { path: 'reference/.format-version', type: 'file', content: '1\n' },
    ] });
    const headA = a.head();
    const staleHead = b.head();
    expect(hasGameReference(a)).toBe(true);
    expect(hasGameReference(b)).toBe(false);

    await expect(writeGameReference([a, b])).resolves.toBe(1);
    expect(a.head()).toBe(headA);
    expect(b.readFile('reference/units.md')).toBeUndefined();
    expect(b.readFile('reference/technologies.json')).toBeUndefined();
    expect(Buffer.from(b.readFile('reference/units.md', staleHead)!).toString('utf8')).toBe('stale');
    expect(namesIn(b, 'reference/units/ancient.json')).toEqual(['Alpha', 'Beta']);
    expect(referencePaths(b)).toHaveLength(referenceFileCount);
    expect(hasGameReference(b)).toBe(true);

    const calls = tools.map((tool) => mcp.calls(tool).length);
    await expect(writeGameReference([a, b])).resolves.toBe(0);
    expect(tools.map((tool) => mcp.calls(tool).length)).toEqual(calls);
  });

  it.each(['missing twin', 'old version'])('should replace a reference with %s', async (reason) => {
    const store = openStore('a');
    await writeGameReference([store]);
    store.commit({ kind: 'reference', turn: null, author: 'host', changes: reason === 'missing twin'
      ? [{ path: 'reference/policies/medieval.json', type: 'delete' }]
      : [{ path: 'reference/.format-version', type: 'file', content: 'old\n' }] });
    const head = store.head();

    await expect(writeGameReference([store])).resolves.toBe(1);

    expect(store.head()).not.toBe(head);
    expect(referencePaths(store)).toHaveLength(referenceFileCount);
    expect(namesIn(store, 'reference/policies/ancient.json')).toEqual(['Alpha', 'Beta']);
    for (const tool of tools) expect(mcp.calls(tool)).toHaveLength(2);
  });

  it('should preserve stale contents and history when a refresh fails', async () => {
    const store = openStore('a');
    store.commit({ kind: 'reference', turn: null, author: 'host', changes: [{ path: 'reference/units.md', type: 'file', content: 'stale' }] });
    const head = store.head();
    mcp.failWith('get-unit', 'offline');

    await expect(writeGameReference([store])).rejects.toThrow('offline');

    expect(store.head()).toBe(head);
    expect(read(store, 'reference/units.md')).toBe('stale');
    expect(store.readFile('reference/.format-version')).toBeUndefined();
  });

  it('should sort absent and sentinel costs as zero before removing internal fields', async () => {
    mcp.respondWith('get-building', structuredResult({ Items: [
      { Name: 'Zulu', Cost: -1 }, { Name: 'Alpha' }, { Name: 'Paid', Cost: 10 },
    ] }));
    const store = openStore('a');

    await writeGameReference([store]);

    expect(JSON.parse(read(store, 'reference/buildings/ancient.json'))).toEqual([
      { Name: 'Alpha' }, { Name: 'Zulu' }, { Name: 'Paid', Cost: 10 },
    ]);
  });
});
