/**
 * Tests for the game reference writer (src/knowledge/reference.ts): one set of detailed listing
 * calls for stores that need a refresh, one commit per store after every listing succeeds that
 * replaces the reference with a file pair for every filled bucket, entries trimmed and bucketed
 * (technologies and units by era, with untechnologied costless units and unknown eras as other;
 * buildings by corporation, religious, era, and other; policies by branch) without the bucketing
 * fields, per-bucket order, Markdown facts limited to what tooltips lack (buildings with a tooltip
 * list none) while JSON keeps every fact, and skipping complete current references.
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
/** The default listings fill one bucket per category: one file pair each plus the format marker. */
const referenceFileCount = categories.length * 2 + 1;

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
  describe('commits and the format marker', () => {
    it('should commit a file pair for every filled bucket to each store with one call per tool', async () => {
      const [a, b] = [openStore('a'), openStore('b')];

      await expect(writeGameReference([a, b])).resolves.toBe(2);

      for (const tool of tools) {
        expect(mcp.calls(tool)).toHaveLength(1);
        expect(mcp.calls(tool)[0].args).toEqual({ MaxResults: 5000, Detailed: true });
      }
      for (const store of [a, b]) {
        expect(referencePaths(store)).toHaveLength(referenceFileCount);
        expect(read(store, 'reference/.format-version')).toMatch(/^\d+\n$/);
        expect(store.history().at(-1)).toMatchObject({ kind: 'reference', turn: null, author: 'host' });
        expect(namesIn(store, 'reference/units/ancient.json')).toEqual(['Alpha', 'Beta']);
        expect(read(store, 'reference/units/ancient.json')).toMatch(/\n$/);
        expect(read(store, 'reference/technologies/ancient.md')).toContain('Alpha');
        expect(read(store, 'reference/technologies/ancient.md')).toContain('Beta');
        expect(store.readFile('reference/units/other.json')).toBeUndefined();
      }
    });

    it('should write no category files when all listings are empty, and still count as incomplete', async () => {
      for (const tool of tools) mcp.respondWith(tool, structuredResult({ Items: [] }));
      const store = openStore('a');

      await writeGameReference([store]);

      expect(referencePaths(store)).toEqual(['reference/.format-version']);
      expect(hasGameReference(store)).toBe(false);
    });
  });

  describe('Markdown facts versus JSON twins', () => {
    it('should list only the tooltip-missing facts in Markdown while JSON keeps every fact', async () => {
      mcp.respondWith('get-policy', structuredResult({ Count: 1, Items: [{ Type: 'POLICY_ONLY', Name: 'Only', Help: 'Grants culture.', Branch: 'Tradition', Era: 'Ancient', PrereqPolicies: ['Root'] }] }));
      mcp.respondWith('get-unit', structuredResult({ Count: 1, Items: [
        { Type: 'UNIT_SPEARMAN', Name: 'Spearman', Combat: 12, Cost: 70, Maintenance: 2, PrereqTech: 'Bronze Working', UpgradesTo: 'Pikeman', Help: 'Cost: 70 Production\nStrength: 12' },
      ] }));
      const store = openStore('a');

      await writeGameReference([store]);

      const policy = read(store, 'reference/policies/tradition.md');
      const section = policy.slice(policy.indexOf('## Only'));
      expect(section).toContain('Root');
      expect(section.indexOf('- Grants culture.')).toBeGreaterThan(section.indexOf('Root'));
      expect(section).not.toContain('###');
      expect(Object.keys(JSON.parse(read(store, 'reference/policies/tradition.json'))[0])).toEqual(['Name', 'PrereqPolicies', 'Help']);

      const unit = read(store, 'reference/units/ancient.md');
      expect(unit).toContain('- Upgrades To: Pikeman');
      expect(unit).toContain('- Maintenance: 2');
      expect(unit).not.toMatch(/Combat|Prereq Tech/);
      expect(JSON.parse(read(store, 'reference/units/ancient.json'))[0]).toMatchObject({ Combat: 12, Cost: 70, PrereqTech: 'Bronze Working', UpgradesTo: 'Pikeman' });
    });

    it('should list every fact in Markdown for an entry without a tooltip', async () => {
      mcp.respondWith('get-unit', structuredResult({ Count: 1, Items: [{ Type: 'UNIT_X', Name: 'Bare', Combat: 9, Cost: 30, PrereqTech: 'Mining' }] }));
      const store = openStore('a');

      await writeGameReference([store]);

      expect(read(store, 'reference/units/ancient.md')).toMatch(/^- Combat: 9$/m);
    });

    it('should list no facts in Markdown for a building with a tooltip while JSON keeps them', async () => {
      mcp.respondWith('get-building', structuredResult({ Items: [
        { Type: 'B1', Name: 'Temple', Cost: 80, PrereqTech: 'Philosophy', Era: 'Medieval', Help: 'A house of worship.' },
        { Type: 'B2', Name: 'Stupa', Cost: 100, PrereqTech: 'Philosophy', Era: 'Medieval' },
      ] }));
      const store = openStore('a');

      await writeGameReference([store]);

      const markdown = read(store, 'reference/buildings/medieval.md');
      const temple = markdown.slice(markdown.indexOf('## Temple'), markdown.indexOf('## Stupa'));
      expect(temple.trimEnd()).toBe('## Temple\n\n- A house of worship.');
      const json = JSON.parse(read(store, 'reference/buildings/medieval.json')) as Record<string, unknown>[];
      expect(json[0]).toMatchObject({ Name: 'Temple', Cost: 80 });
      expect(markdown.slice(markdown.indexOf('## Stupa'))).toContain('- Cost: 100');
    });

    it('should omit Replaces and Unique Of from building Markdown while JSON keeps them', async () => {
      mcp.respondWith('get-building', structuredResult({ Items: [
        { Type: 'BUILDING_MAYA_PYRAMID', Name: 'Pyramid', Cost: 100, UniqueOf: 'Maya', Replaces: 'Temple', Help: 'A Maya shrine.' },
      ] }));
      const store = openStore('a');

      await writeGameReference([store]);

      const markdown = read(store, 'reference/buildings/other.md');
      expect(markdown.trimEnd()).toBe('# Buildings: Other\n\n## Pyramid\n\n- A Maya shrine.');
      expect(JSON.parse(read(store, 'reference/buildings/other.json'))).toEqual([
        { Name: 'Pyramid', Cost: 100, UniqueOf: 'Maya', Replaces: 'Temple', Help: 'A Maya shrine.' },
      ]);
    });
  });

  describe('bucketing', () => {
    it('should file policies by branch, titled with the branch era, and branchless ones as other', async () => {
      mcp.respondWith('get-policy', structuredResult({ Items: [
        { Type: 'P1', Name: 'Fealty One', Era: 'Medieval', Branch: 'Fealty', Level: 1 },
        { Type: 'P2', Name: 'Free Spirit', Era: 'Industrial', Branch: 'Free Spirit', Level: 1 },
        { Type: 'P3', Name: 'Loose', Era: 'Ancient' },
        { Type: 'P4', Name: 'Ершов', Era: 'Ancient', Branch: 'Традиция', Level: 1 },
      ] }));
      const store = openStore('a');

      await writeGameReference([store]);

      const files = referencePaths(store).filter((storePath) => storePath.startsWith('reference/policies/')).sort();
      expect(files).toEqual([
        'reference/policies/fealty.json', 'reference/policies/fealty.md',
        'reference/policies/free-spirit.json', 'reference/policies/free-spirit.md',
        'reference/policies/other.json', 'reference/policies/other.md',
        'reference/policies/традиция.json', 'reference/policies/традиция.md',
      ]);
      expect(read(store, 'reference/policies/fealty.md').split('\n')[0]).toMatch(/Fealty.*Medieval/);
      expect(namesIn(store, 'reference/policies/other.json')).toEqual(['Loose']);
      expect(read(store, 'reference/policies/fealty.json')).not.toMatch(/"Branch"|"Era"/);
    });

    it('should file no-technology buildings as other and no-cost units as other', async () => {
      mcp.respondWith('get-building', structuredResult({ Items: [
        { Type: 'B1', Name: 'Franchise', Cost: -1 },
        { Type: 'B2', Name: 'Monument', Cost: 65 },
        { Type: 'B3', Name: 'Granary', Cost: 65, PrereqTech: 'Pottery', Era: 'Ancient' },
      ] }));
      mcp.respondWith('get-unit', structuredResult({ Items: [
        { Type: 'U1', Name: 'Great Engineer', Cost: 0 },
        { Type: 'U2', Name: 'Warrior', Cost: 40 },
      ] }));
      const store = openStore('a');

      await writeGameReference([store]);

      expect(namesIn(store, 'reference/buildings/other.json')).toEqual(['Franchise', 'Monument']);
      expect(namesIn(store, 'reference/buildings/ancient.json')).toEqual(['Granary']);
      expect(namesIn(store, 'reference/units/other.json')).toEqual(['Great Engineer']);
      expect(namesIn(store, 'reference/units/ancient.json')).toEqual(['Warrior']);
    });

    it('should file corporation buildings in their own bucket titled Buildings: Corporations', async () => {
      mcp.respondWith('get-building', structuredResult({ Items: [
        { Type: 'C1', Name: 'Steel Headquarters', Corporation: 'Steel', Cost: -1 },
        { Type: 'C2', Name: 'Office', Corporation: 'Steel', Cost: 100, PrereqTech: 'Industrialism', Era: 'Industrial' },
        { Type: 'B3', Name: 'Granary', Cost: 65, PrereqTech: 'Pottery', Era: 'Ancient' },
      ] }));
      const store = openStore('a');

      await writeGameReference([store]);

      expect(namesIn(store, 'reference/buildings/corporations.json')).toEqual(['Steel Headquarters', 'Office']);
      expect(read(store, 'reference/buildings/corporations.md').split('\n')[0]).toBe('# Buildings: Corporations');
      expect(store.readFile('reference/buildings/industrial.json')).toBeUndefined();
      expect(namesIn(store, 'reference/buildings/ancient.json')).toEqual(['Granary']);
    });

    it('should file belief buildings without a technology as religious and keep ones with a technology in their era', async () => {
      mcp.respondWith('get-building', structuredResult({ Items: [
        { Type: 'R1', Name: 'Mosque', Cost: 120, UnlockedByBeliefs: ['God of the Open Sky'] },
        { Type: 'R2', Name: 'Temple', Cost: 100, PrereqTech: 'Philosophy', Era: 'Medieval', UnlockedByBeliefs: ['God of the Open Sky'] },
      ] }));
      const store = openStore('a');

      await writeGameReference([store]);

      expect(namesIn(store, 'reference/buildings/religious.json')).toEqual(['Mosque']);
      expect(read(store, 'reference/buildings/religious.md').split('\n')[0]).toBe('# Buildings: Religious');
      expect(namesIn(store, 'reference/buildings/medieval.json')).toEqual(['Temple']);
      expect(store.readFile('reference/buildings/other.json')).toBeUndefined();
    });

    it('should file missing eras as ancient and unknown eras as other, keeping every entry', async () => {
      mcp.respondWith('get-unit', structuredResult({ Items: [
        { Type: 'U1', Name: 'Warrior', Era: null, Cost: 10 },
        { Type: 'U2', Name: 'Settler', Cost: 10 },
        { Type: 'U3', Name: 'Slinger', Era: 'Ancient', Cost: 10 },
        { Type: 'U4', Name: 'Alien', Era: 'Future', Cost: 10 },
      ] }));
      const store = openStore('a');

      await writeGameReference([store]);

      expect(namesIn(store, 'reference/units/ancient.json')).toEqual(['Settler', 'Slinger', 'Warrior']);
      expect(namesIn(store, 'reference/units/other.json')).toEqual(['Alien']);
      expect(read(store, 'reference/units/other.json')).not.toMatch(/"Era"/);
      const unitFiles = referencePaths(store).filter((storePath) => storePath.startsWith('reference/units/') && storePath.endsWith('.json'));
      expect(unitFiles.reduce((sum, file) => sum + namesIn(store, file).length, 0)).toBe(4);
    });
  });

  describe('trimming and order', () => {
    it('should drop empty values and AI internals', async () => {
      mcp.respondWith('get-unit', structuredResult({ Count: 1, Items: [
        { Type: 'UNIT_WARRIOR', Name: 'Warrior', Help: 'Melee unit.', Combat: 8, RangedCombat: 0, Cost: 40, UniqueOf: null, AIType: 'Attack', Description: 'Advice', FreePromotions: [], RequiredResources: {}, PrereqTech: null },
      ] }));
      mcp.respondWith('get-building', structuredResult({ Count: 1, Items: [{ Type: 'BUILDING_PALACE', Name: 'Palace', Help: 'Capital.', Cost: -1, Maintenance: 0, IsWorldWonder: false, Strategy: 'Advice' }] }));
      const store = openStore('a');

      await writeGameReference([store]);

      expect(JSON.parse(read(store, 'reference/units/ancient.json'))).toEqual([{ Name: 'Warrior', Combat: 8, Cost: 40, Help: 'Melee unit.' }]);
      expect(JSON.parse(read(store, 'reference/buildings/other.json'))).toEqual([{ Name: 'Palace', Help: 'Capital.' }]);
      for (const file of ['units/ancient', 'buildings/other']) {
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

      expect(JSON.parse(read(store, 'reference/units/other.json'))).toEqual([
        { Name: 'Jaguar', UniqueOf: 'Aztec', Replaces: 'Warrior' },
        { Name: 'Warrior' },
      ]);
      expect(JSON.parse(read(store, 'reference/buildings/other.json'))).toEqual([{ Name: 'Pyramid', UniqueOf: 'Maya', Replaces: 'Temple' }]);
    });

    it('should order entries within each bucket, title files by category and bucket, and remove bucketing fields', async () => {
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
      expect(headings('policies/tradition')).toEqual(['## Tradition One', '## Tradition Two']);
      expect(headings('policies/authority')).toEqual(['## Authority One']);
      expect(headings('policies/liberty')).toEqual(['## Centralization']);
      expect(headings('units/ancient')).toEqual(['## Chariot', '## Spearman', '## Worker']);
      expect(read(store, 'reference/policies/tradition.json')).not.toMatch(/"Type"|"Level"/);
      expect(read(store, 'reference/policies/tradition.md')).not.toMatch(/Type|Level/);
      for (const era of ['ancient', 'classical', 'medieval']) {
        expect(read(store, `reference/technologies/${era}.json`)).not.toMatch(/"Era"/);
      }
      expect(read(store, 'reference/technologies/ancient.md').split('\n')[0]).toMatch(/^# Technologies\b.*Ancient/);
      expect(read(store, 'reference/technologies/ancient.md').split('\n').slice(1).join('\n')).not.toMatch(/Era/);
    });

    it('should sort absent and sentinel costs as zero before removing internal fields', async () => {
      mcp.respondWith('get-building', structuredResult({ Items: [
        { Name: 'Zulu', Cost: -1 }, { Name: 'Alpha' }, { Name: 'Paid', Cost: 10 },
      ] }));
      const store = openStore('a');

      await writeGameReference([store]);

      expect(JSON.parse(read(store, 'reference/buildings/other.json'))).toEqual([
        { Name: 'Alpha' }, { Name: 'Zulu' }, { Name: 'Paid', Cost: 10 },
      ]);
      expect(store.readFile('reference/buildings/ancient.json')).toBeUndefined();
    });
  });

  describe('failure and refresh', () => {
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
        ? [{ path: 'reference/policies/other.json', type: 'delete' }]
        : [{ path: 'reference/.format-version', type: 'file', content: 'old\n' }] });
      const head = store.head();

      await expect(writeGameReference([store])).resolves.toBe(1);

      expect(store.head()).not.toBe(head);
      expect(referencePaths(store)).toHaveLength(referenceFileCount);
      expect(namesIn(store, 'reference/policies/other.json')).toEqual(['Alpha', 'Beta']);
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
  });
});
