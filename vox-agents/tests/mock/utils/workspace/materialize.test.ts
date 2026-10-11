/** Tests for copying a seat store version out as files (src/utils/workspace/materialize.ts). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: { telemetryDir: '' },
}));

vi.mock('../../../../src/utils/config.js', () => ({ config: mocks.config }));

import { diskSink, materialize, type MaterializeSink } from '../../../../src/utils/workspace/materialize.js';
import { WorkspaceStore } from '../../../../src/utils/workspace/workspace-store.js';

/** One entry a sink received. */
type Received =
  | { kind: 'file'; path: string; bytes: Uint8Array; mode: number; mtime: number }
  | { kind: 'directory'; path: string; mode: number; mtime: number };

/** A sink that records what it receives. */
function recordingSink(): { sink: MaterializeSink; received: Received[] } {
  const received: Received[] = [];
  return {
    received,
    sink: {
      file: (storePath, bytes, mode, mtime) => received.push({ kind: 'file', path: storePath, bytes: new Uint8Array(bytes), mode, mtime }),
      directory: (storePath, mode, mtime) => received.push({ kind: 'directory', path: storePath, mode, mtime }),
    },
  };
}

describe('materialize', () => {
  const binary = new Uint8Array([0, 1, 2, 250, 255, 0]);
  let dir: string;
  let dbPath: string;
  let store: WorkspaceStore;
  let first: number;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-materialize-'));
    mocks.config.telemetryDir = dir;
    dbPath = path.join(dir, 'seat.db');
    store = WorkspaceStore.open(dbPath);
    first = store.commit({
      kind: 'turn', turn: 1, author: 'host', changes: [
        { path: 'records/turn-1/state.md', type: 'file', content: 'v1', mode: 0o644, mtime: 1_000_000 },
        { path: 'game/image.bin', type: 'file', content: binary, mode: 0o600, mtime: 2_000_000 },
        { path: 'game/empty', type: 'dir', mode: 0o700, mtime: 3_000_000 },
      ],
    });
    store.commit({
      kind: 'notes', turn: 1, author: 'agent', changes: [
        { path: 'records/turn-1/state.md', type: 'file', content: 'v2', mtime: 4_000_000 },
        { path: 'game/notes/new.md', type: 'file', content: 'new' },
      ],
    });
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should hand head to the sink with contents, directories, modes, and times', () => {
    const { sink, received } = recordingSink();
    expect(materialize(dbPath, sink)).toBe(store.head());
    expect(received.map((entry) => entry.path)).toEqual(['game/image.bin', 'game/notes/new.md', 'records/turn-1/state.md', 'game/empty']);
    expect(received[0]).toEqual({ kind: 'file', path: 'game/image.bin', bytes: binary, mode: 0o600, mtime: 2_000_000 });
    expect(Buffer.from((received[2] as { bytes: Uint8Array }).bytes).toString()).toBe('v2');
    expect(received[3]).toEqual({ kind: 'directory', path: 'game/empty', mode: 0o700, mtime: 3_000_000 });
  });

  it('should hand an older commit as it was', () => {
    const { sink, received } = recordingSink();
    expect(materialize(dbPath, sink, first)).toBe(first);
    const state = received.find((entry) => entry.path === 'records/turn-1/state.md') as { bytes: Uint8Array; mtime: number };
    expect(Buffer.from(state.bytes).toString()).toBe('v1');
    expect(state.mtime).toBe(1_000_000);
    expect(received.some((entry) => entry.path === 'game/notes/new.md')).toBe(false);
  });

  it('should hand nothing for the initial commit', () => {
    const { sink, received } = recordingSink();
    materialize(dbPath, sink, store.history()[0].id);
    expect(received).toEqual([]);
  });

  it('should write files to disk', () => {
    const outDir = path.join(dir, 'out');
    materialize(dbPath, diskSink(outDir), first);
    expect(fs.readFileSync(path.join(outDir, 'records', 'turn-1', 'state.md'), 'utf8')).toBe('v1');
    expect(new Uint8Array(fs.readFileSync(path.join(outDir, 'game', 'image.bin')))).toEqual(binary);
    expect(fs.statSync(path.join(outDir, 'game', 'empty')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(outDir, 'game', 'image.bin')).mtimeMs).toBe(2_000_000);
    expect(fs.statSync(path.join(outDir, 'game', 'empty')).mtimeMs).toBe(3_000_000);
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(outDir, 'game', 'image.bin')).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.join(outDir, 'game', 'empty')).mode & 0o777).toBe(0o700);
    }
  });

  it('should require a new or empty output folder', () => {
    const outDir = path.join(dir, 'busy');
    fs.mkdirSync(outDir);
    fs.writeFileSync(path.join(outDir, 'existing.txt'), 'x');
    expect(() => diskSink(outDir)).toThrow();
    const emptyDir = path.join(dir, 'empty-out');
    fs.mkdirSync(emptyDir);
    expect(() => diskSink(emptyDir)).not.toThrow();
  });

  it('should report a missing store without creating it', () => {
    const missing = path.join(dir, 'missing.db');
    expect(() => materialize(missing, recordingSink().sink)).toThrow();
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('should report an unknown commit', () => {
    expect(() => materialize(dbPath, recordingSink().sink, 9999)).toThrow();
  });

  it('should leave the store unchanged while another connection has it open', () => {
    const head = store.head();
    const history = store.history();
    materialize(dbPath, recordingSink().sink);
    materialize(dbPath, recordingSink().sink, first);
    expect(store.head()).toBe(head);
    expect(store.history()).toEqual(history);
    store.commit({ kind: 'notes', turn: 2, author: 'agent', changes: [{ path: 'game/after.md', type: 'file', content: 'after' }] });
    expect(store.readFile('game/after.md')).toBeDefined();
  });
});
