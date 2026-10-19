/** Tests for the versioned seat store (src/utils/workspace/workspace-store.ts). */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { trace } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceStore, type PathChange } from '../../../../src/utils/workspace/workspace-store.js';

/** Decode stored bytes as UTF-8 text. */
function text(bytes: Uint8Array | undefined): string | undefined {
  return bytes === undefined ? undefined : Buffer.from(bytes).toString('utf8');
}

describe('WorkspaceStore', () => {
  let dir: string;
  let dbPath: string;
  let store: WorkspaceStore;

  /** Commit file changes with a given kind and turn. */
  function commit(changes: PathChange[], kind: 'turn' | 'briefing' | 'notes' | 'reference' = 'notes', turn: number | null = 1): number {
    return store.commit({ kind, turn, author: 'host', changes });
  }

  /** Commit one `turn` record for a turn. */
  function recordTurn(turn: number): number {
    return commit([{ path: `records/turn-${turn}/state.md`, type: 'file', content: `turn ${turn}` }], 'turn', turn);
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-store-'));
    dbPath = path.join(dir, 'nested', 'seat.db');
    store = WorkspaceStore.open(dbPath);
  });

  afterEach(() => {
    store.close();
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('creation', () => {
    it('should create an empty init commit and head together', () => {
      const history = store.history();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ parent: null, turn: null, kind: 'init' });
      expect(store.head()).toBe(history[0].id);
      expect(store.manifest().size).toBe(0);
      expect(store.lastRecordedTurn()).toBeUndefined();
    });

    it('should keep the init commit and head on reopening', () => {
      const id = commit([{ path: 'game/a.md', type: 'file', content: 'a' }]);
      store.close();
      store = WorkspaceStore.open(dbPath);
      expect(store.head()).toBe(id);
      expect(store.history().map((entry) => entry.kind)).toEqual(['init', 'notes']);
      expect(text(store.readFile('game/a.md'))).toBe('a');
    });

    it('should use WAL mode', () => {
      const db = new Database(dbPath, { readonly: true });
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      db.close();
    });

    it('should refuse a read-only open of a missing store', () => {
      expect(() => WorkspaceStore.open(path.join(dir, 'missing.db'), { readonly: true })).toThrow();
      expect(fs.existsSync(path.join(dir, 'missing.db'))).toBe(false);
    });
  });

  describe('seat telemetry file', () => {
    /** Open a store with one commit and stamp every commit's time so newest comparisons are deterministic. */
    function makeStampedStore(file: string, time: number): void {
      const seat = WorkspaceStore.open(file);
      seat.commit({ kind: 'notes', turn: 1, author: 'host', changes: [{ path: 'game/note.md', type: 'file', content: `note ${time}` }] });
      seat.close();
      const db = new Database(file);
      db.prepare('UPDATE ws_commits SET time = ?').run(time);
      db.close();
    }

    it('should coexist with a spans table in one file', () => {
      const file = path.join(dir, 'telemetry', 'g1-player-1.db');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const telemetry = new Database(file);
      telemetry.exec('CREATE TABLE spans (contextId TEXT, name TEXT)');
      telemetry.prepare('INSERT INTO spans VALUES (?, ?)').run('g1-player-1', 'turn');
      telemetry.close();

      const seat = WorkspaceStore.open(file);
      seat.commit({ kind: 'notes', turn: 1, author: 'host', changes: [{ path: 'game/note.md', type: 'file', content: 'note' }] });
      seat.close();

      const reopened = WorkspaceStore.open(file);
      expect(text(reopened.readFile('game/note.md'))).toBe('note');
      reopened.close();
      const check = new Database(file, { readonly: true });
      expect(check.prepare('SELECT name FROM spans').all()).toEqual([{ name: 'turn' }]);
      check.close();
    });

    it('should report hasStore only for a file that holds a store', () => {
      expect(WorkspaceStore.hasStore(path.join(dir, 'missing', 'seat.db'))).toBe(false);

      const spansOnly = path.join(dir, 'spans-only.db');
      const telemetry = new Database(spansOnly);
      telemetry.exec('CREATE TABLE spans (contextId TEXT, name TEXT)');
      telemetry.close();
      expect(WorkspaceStore.hasStore(spansOnly)).toBe(false);

      const file = path.join(dir, 'flag.db');
      expect(WorkspaceStore.hasStore(file)).toBe(false);
      const seat = WorkspaceStore.open(file);
      expect(WorkspaceStore.hasStore(file)).toBe(true);
      seat.close();
    });

    it('should find the sibling store with the newest commit and skip the workspaces folder', () => {
      const base = Date.now();
      const inA = path.join(dir, 'a', 'seat.db');
      const inB = path.join(dir, 'b', 'seat.db');
      makeStampedStore(inA, base + 1_000);
      makeStampedStore(inB, base + 2_000);
      makeStampedStore(path.join(dir, 'workspaces', 'seat.db'), base + 3_000);

      // The folder being opened into (c) and the always-present nested store are both older or absent.
      expect(WorkspaceStore.findSeed(path.join(dir, 'c', 'seat.db'))).toBe(path.resolve(inB));
      expect(WorkspaceStore.findSeed(inA)).toBe(path.resolve(inB));
    });

    it('should find no seed when no sibling holds a store', () => {
      expect(WorkspaceStore.findSeed(path.join(dir, 'c', 'lonely.db'))).toBeUndefined();
    });

    it('should copy the seed store whole into a file that has no store', () => {
      const seedFile = path.join(dir, 'seed', 'seat.db');
      const seed = WorkspaceStore.open(seedFile);
      seed.commit({ kind: 'notes', turn: 1, author: 'host', changes: [{ path: 'game/plan.md', type: 'file', content: 'plan' }] });
      const head = seed.commit({ kind: 'turn', turn: 2, author: 'host', changes: [{ path: 'records/turn-2/state.md', type: 'file', content: 'turn 2' }] });
      const history = seed.history();
      const plan = seed.readFile('game/plan.md')!;
      seed.close();

      const copy = WorkspaceStore.open(path.join(dir, 'new-strategist', 'seat.db'), { seedFrom: seedFile });
      expect(copy.head()).toBe(head);
      expect(copy.history()).toEqual(history);
      expect(copy.readFile('game/plan.md')).toEqual(plan);
      expect(text(copy.readFile('records/turn-2/state.md'))).toBe('turn 2');
      copy.close();
    });

    it('should bring an earlier copy up to the seed, keeping its own commit IDs', () => {
      const originalFile = path.join(dir, 'catch-up-a', 'seat.db');
      const original = WorkspaceStore.open(originalFile);
      const early = original.commit({ kind: 'notes', turn: 1, author: 'host', changes: [{ path: 'game/plan.md', type: 'file', content: 'old plan' }] });
      original.close();

      // Strategist B copies A's store and moves on; A's file stays at the earlier commit.
      const seedFile = path.join(dir, 'catch-up-b', 'seat.db');
      const seed = WorkspaceStore.open(seedFile, { seedFrom: originalFile });
      seed.commit({ kind: 'turn', turn: 2, author: 'host', changes: [{ path: 'records/turn-2/state.md', type: 'file', content: 'turn 2' }] });
      const seedHead = seed.commit({ kind: 'notes', turn: 2, author: 'host', changes: [{ path: 'game/plan.md', type: 'file', content: 'new plan' }] });
      const history = seed.history();
      seed.close();

      const resumed = WorkspaceStore.open(originalFile, { seedFrom: seedFile });
      expect(resumed.head()).toBe(seedHead);
      expect(resumed.history()).toEqual(history);
      expect(text(resumed.readFile('game/plan.md'))).toBe('new plan');
      expect(text(resumed.readFile('game/plan.md', early))).toBe('old plan');
      expect(text(resumed.readFile('records/turn-2/state.md'))).toBe('turn 2');
      resumed.close();
    });

    it('should leave a store whose history differs from the seed', () => {
      const targetPath = path.join(dir, 'reseed-target', 'seat.db');
      const own = WorkspaceStore.open(targetPath);
      const head = own.commit({ kind: 'notes', turn: 1, author: 'host', changes: [{ path: 'game/own.md', type: 'file', content: 'own' }] });
      own.close();

      // An unrelated store with more commits than the target.
      const seedFile = path.join(dir, 'reseed-seed', 'seat.db');
      const seed = WorkspaceStore.open(seedFile);
      seed.commit({ kind: 'notes', turn: 5, author: 'host', changes: [{ path: 'game/plan.md', type: 'file', content: 'seeded' }] });
      seed.commit({ kind: 'notes', turn: 6, author: 'host', changes: [{ path: 'game/more.md', type: 'file', content: 'more' }] });
      seed.close();

      const reopened = WorkspaceStore.open(targetPath, { seedFrom: seedFile });
      expect(reopened.head()).toBe(head);
      expect(text(reopened.readFile('game/own.md'))).toBe('own');
      expect(reopened.readFile('game/plan.md')).toBeUndefined();
      reopened.close();
    });
  });

  describe('files and versions', () => {
    it('should round-trip text and binary files', () => {
      const binary = new Uint8Array([0, 255, 1, 254, 0, 10, 13]);
      commit([
        { path: 'records/a.md', type: 'file', content: 'héllo' },
        { path: 'game/bin.dat', type: 'file', content: binary, mode: 0o600, mtime: 1234 },
        { path: 'game/empty.txt', type: 'file', content: '' },
      ]);
      expect(text(store.readFile('records/a.md'))).toBe('héllo');
      expect(store.readFile('game/bin.dat')).toEqual(binary);
      expect(store.readFile('game/empty.txt')).toEqual(new Uint8Array(0));
      expect(store.manifest().get('game/bin.dat')).toMatchObject({ type: 'file', size: binary.length, mode: 0o600, mtime: 1234 });
    });

    it('should store identical contents once and compress only when smaller', () => {
      const compressible = 'abc'.repeat(1000);
      const random = new Uint8Array(crypto.randomBytes(512));
      commit([
        { path: 'game/one.md', type: 'file', content: compressible },
        { path: 'game/two.md', type: 'file', content: compressible },
        { path: 'game/random.bin', type: 'file', content: random },
      ]);
      expect(store.readFile('game/two.md')).toEqual(store.readFile('game/one.md'));
      expect(store.readFile('game/random.bin')).toEqual(random);

      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare('SELECT size, compressed, length(data) AS stored FROM ws_blobs ORDER BY size').all() as
        { size: number; compressed: number; stored: number }[];
      db.close();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ size: 512, compressed: 0, stored: 512 });
      expect(rows[1].size).toBe(3000);
      expect(rows[1].compressed).toBe(1);
      expect(rows[1].stored).toBeLessThan(3000);
    });

    it('should read older commits as they were', () => {
      const first = commit([{ path: 'game/a.md', type: 'file', content: 'v1' }]);
      commit([{ path: 'game/a.md', type: 'file', content: 'v2' }, { path: 'game/b.md', type: 'file', content: 'b' }]);
      expect(text(store.readFile('game/a.md', first))).toBe('v1');
      expect(store.manifest(first).has('game/b.md')).toBe(false);
      expect(text(store.readFile('game/a.md'))).toBe('v2');
      expect(store.manifest(store.history()[0].id).size).toBe(0);
    });

    it('should keep empty directories and let a delete remove everything under a path', () => {
      commit([
        { path: 'game/empty', type: 'dir', mode: 0o700, mtime: 99 },
        { path: 'game/notes/a.md', type: 'file', content: 'a' },
        { path: 'game/notes/deep/b.md', type: 'file', content: 'b' },
        { path: 'game/keep.md', type: 'file', content: 'k' },
      ]);
      expect(store.manifest().get('game/empty')).toEqual({ type: 'dir', mode: 0o700, mtime: 99 });
      expect(store.manifest().has('game/notes')).toBe(false);

      commit([{ path: 'game/notes', type: 'delete' }]);
      expect([...store.manifest().keys()].sort()).toEqual(['game/empty', 'game/keep.md']);
    });

    it('should let later commits win path by path', () => {
      commit([{ path: 'game/a.md', type: 'file', content: 'a1' }, { path: 'game/b.md', type: 'file', content: 'b1' }]);
      commit([{ path: 'game/b.md', type: 'file', content: 'b2' }]);
      expect(text(store.readFile('game/a.md'))).toBe('a1');
      expect(text(store.readFile('game/b.md'))).toBe('b2');
    });

    it('should see commits made through another connection', () => {
      store.manifest();
      const other = WorkspaceStore.open(dbPath);
      other.commit({ kind: 'notes', turn: 1, author: 'other', changes: [{ path: 'game/x.md', type: 'file', content: 'x' }] });
      other.close();
      expect(text(store.readFile('game/x.md'))).toBe('x');
    });

    it('should reject paths outside records, game, and reference', () => {
      const head = store.head();
      expect(() => commit([{ path: 'other/a.md', type: 'file', content: 'a' }])).toThrow();
      expect(() => commit([{ path: 'game/../x', type: 'file', content: 'a' }])).toThrow();
      expect(() => commit([{ path: '/game/a', type: 'file', content: 'a' }])).toThrow();
      expect(store.head()).toBe(head);
      expect(store.history()).toHaveLength(1);
    });

    it('should replace a store folder atomically while keeping other folders and history', () => {
      const original = commit([
        { path: 'reference/units.md', type: 'file', content: 'old' },
        { path: 'game/note.md', type: 'file', content: 'note' },
      ]);
      commit([
        { path: 'reference', type: 'delete' },
        { path: 'reference/units/ancient.md', type: 'file', content: 'new' },
      ]);

      expect(store.readFile('reference/units.md')).toBeUndefined();
      expect(text(store.readFile('reference/units/ancient.md'))).toBe('new');
      expect(text(store.readFile('game/note.md'))).toBe('note');
      expect(text(store.readFile('reference/units.md', original))).toBe('old');
      expect(() => commit([{ path: 'reference', type: 'file', content: 'invalid' }])).toThrow();
      expect(() => commit([{ path: 'reference', type: 'dir' }])).toThrow();
      expect(() => commit([{ path: 'other', type: 'delete' }])).toThrow();
    });
  });

  describe('commit', () => {
    it('should apply derived files from the resulting tree in the same commit', () => {
      commit([{ path: 'records/old.md', type: 'file', content: 'old' }]);
      const id = store.commit({
        kind: 'turn',
        turn: 2,
        author: 'host',
        changes: [{ path: 'records/new.md', type: 'file', content: 'new' }],
        derive: (tree, read) => [{
          path: 'records/CATALOG.md',
          type: 'file',
          content: [...tree.keys()].sort().map((key) => `${key}=${text(read(key))}`).join('\n'),
        }],
      });
      expect(store.head()).toBe(id);
      expect(text(store.readFile('records/CATALOG.md'))).toBe('records/new.md=new\nrecords/old.md=old');
      expect(store.history()).toHaveLength(3);
    });

    it('should write nothing when the signal is aborted', () => {
      const head = store.head();
      const controller = new AbortController();
      controller.abort();
      expect(() => store.commit({
        kind: 'notes', turn: 1, author: 'agent', signal: controller.signal,
        changes: [{ path: 'game/a.md', type: 'file', content: 'a' }],
      })).toThrow();
      expect(store.head()).toBe(head);
      expect(store.history()).toHaveLength(1);
      expect(store.manifest().size).toBe(0);
    });

    it('should write nothing when derive throws', () => {
      const head = store.head();
      expect(() => store.commit({
        kind: 'turn', turn: 1, author: 'host',
        changes: [{ path: 'records/a.md', type: 'file', content: 'a' }],
        derive: () => { throw new Error('boom'); },
      })).toThrow('boom');
      expect(store.head()).toBe(head);
      expect(store.manifest().size).toBe(0);
    });

    it('should record the active span and the author', () => {
      const traceId = 'a'.repeat(32);
      const spanId = 'b'.repeat(16);
      vi.spyOn(trace, 'getActiveSpan').mockReturnValue(trace.wrapSpanContext({ traceId, spanId, traceFlags: 1 }));
      const id = store.commit({ kind: 'notes', turn: 4, author: 'diplomat', changes: [] });
      expect(store.history().find((entry) => entry.id === id)).toMatchObject({ traceId, spanId, author: 'diplomat', turn: 4, kind: 'notes' });
    });

    it('should leave trace IDs empty outside a span', () => {
      const id = commit([]);
      expect(store.history().find((entry) => entry.id === id)).toMatchObject({ traceId: null, spanId: null });
    });
  });

  describe('lastRecordedTurn', () => {
    it('should count only turn commits', () => {
      recordTurn(1);
      commit([{ path: 'records/turn-2/briefing.md', type: 'file', content: 'early' }], 'briefing', 2);
      commit([{ path: 'game/note.md', type: 'file', content: 'n' }], 'notes', 2);
      expect(store.lastRecordedTurn()).toBe(1);
    });
  });

  describe('rewind', () => {
    it('should do nothing unless the last recorded turn reaches the target', () => {
      expect(store.rewind(1)).toBe(false);
      recordTurn(1);
      commit([{ path: 'records/turn-2/briefing.md', type: 'file', content: 'early' }], 'briefing', 2);
      const head = store.head();
      expect(store.rewind(2)).toBe(false);
      expect(store.head()).toBe(head);
      expect(store.history()).toHaveLength(3);
    });

    it('should move head before the oldest turn commit at or after the target and add a reload commit', () => {
      recordTurn(1);
      commit([{ path: 'game/turn1.md', type: 'file', content: 'kept' }], 'notes', 1);
      const beforeTwo = store.head();
      recordTurn(2);
      commit([{ path: 'game/turn2.md', type: 'file', content: 'dropped' }], 'notes', 2);
      recordTurn(3);
      // A late note tagged with an older turn, committed after turn 3 was recorded.
      commit([{ path: 'game/late.md', type: 'file', content: 'dropped' }], 'notes', 1);
      const total = store.history().length;

      expect(store.rewind(2)).toBe(true);
      const head = store.history().find((entry) => entry.id === store.head())!;
      expect(head).toMatchObject({ kind: 'reload', turn: 2, parent: beforeTwo });
      expect([...store.manifest().keys()].sort()).toEqual(['game/turn1.md', 'records/turn-1/state.md']);
      expect(store.lastRecordedTurn()).toBe(1);
      expect(store.history()).toHaveLength(total + 1);
      expect(store.hasCommit(beforeTwo + 1)).toBe(true);
    });

    it('should keep the init commit when the first turn is discarded', () => {
      const init = store.head();
      recordTurn(5);
      recordTurn(6);
      expect(store.rewind(5)).toBe(true);
      const head = store.history().find((entry) => entry.id === store.head())!;
      expect(head).toMatchObject({ kind: 'reload', turn: 5, parent: init });
      expect(store.manifest().size).toBe(0);
      expect(store.lastRecordedTurn()).toBeUndefined();
    });

    it('should let a new timeline build on the reload commit', () => {
      recordTurn(1);
      recordTurn(2);
      store.rewind(2);
      recordTurn(2);
      expect(store.lastRecordedTurn()).toBe(2);
      expect(store.rewind(3)).toBe(false);
      expect(text(store.readFile('records/turn-2/state.md'))).toBe('turn 2');
    });

    it('should carry forward reference files the discarded commits added or changed', () => {
      commit([{ path: 'reference/units.md', type: 'file', content: 'old units' }], 'reference', null);
      recordTurn(1);
      recordTurn(2);
      // A store from before the reference moved in gets it only after some turns are recorded.
      commit([
        { path: 'reference/units.md', type: 'file', content: 'new units' },
        { path: 'reference/techs.md', type: 'file', content: 'techs' },
        { path: 'reference/.format-version', type: 'file', content: '1\n' },
      ], 'reference', null);
      recordTurn(3);

      expect(store.rewind(2)).toBe(true);
      expect(text(store.readFile('reference/units.md'))).toBe('new units');
      expect(text(store.readFile('reference/techs.md'))).toBe('techs');
      expect(text(store.readFile('reference/.format-version'))).toBe('1\n');
      expect(store.readFile('records/turn-2/state.md')).toBeUndefined();

      // Reopening rebuilds the tree from stored rows rather than the cache.
      store.close();
      store = WorkspaceStore.open(dbPath);
      expect(text(store.readFile('reference/units.md'))).toBe('new units');
      expect(text(store.readFile('reference/.format-version'))).toBe('1\n');
      expect(store.lastRecordedTurn()).toBe(1);
    });

    it('should preserve reference removals across repeated reloads and reopening', () => {
      const original = commit([
        { path: 'reference/units/ancient.md', type: 'file', content: 'outdated units' },
        { path: 'reference/units/obsolete.md', type: 'file', content: 'obsolete' },
      ], 'reference', null);
      recordTurn(1);
      recordTurn(2);
      commit([
        { path: 'reference/units/obsolete.md', type: 'delete' },
        { path: 'reference/units/ancient.md', type: 'file', content: 'current units' },
        { path: 'reference/units/other.json', type: 'file', content: '[]\n' },
        { path: 'reference/.format-version', type: 'file', content: '2\n' },
      ], 'reference', null);

      expect(store.rewind(2)).toBe(true);
      expect(store.rewind(1)).toBe(true);
      store.close();
      store = WorkspaceStore.open(dbPath);

      expect(store.readFile('reference/units/obsolete.md')).toBeUndefined();
      expect(text(store.readFile('reference/units/ancient.md'))).toBe('current units');
      expect(text(store.readFile('reference/units/other.json'))).toBe('[]\n');
      expect(text(store.readFile('reference/.format-version'))).toBe('2\n');
      expect(store.readFile('records/turn-1/state.md')).toBeUndefined();
      expect(text(store.readFile('reference/units/obsolete.md', original))).toBe('obsolete');
    });
  });
});
