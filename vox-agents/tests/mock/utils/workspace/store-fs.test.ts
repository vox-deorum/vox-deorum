/** Tests for the bash view of the seat store (src/utils/workspace/store-fs.ts). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bash, InMemoryFs, MountableFs, OverlayFs, type IFileSystem } from 'just-bash';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: { telemetryDir: '' },
}));

vi.mock('../../../../src/utils/config.js', () => ({ config: mocks.config }));

import { StoreFs } from '../../../../src/utils/workspace/store-fs.js';
import { WorkspaceStore, type PathChange } from '../../../../src/utils/workspace/workspace-store.js';

/** A shell with one filesystem mounted at /workspace/game, starting in /workspace. */
function shell(filesystem: IFileSystem): Bash {
  const root = new MountableFs({ base: new InMemoryFs(), mounts: [{ mountPoint: '/workspace/game', filesystem }] });
  return new Bash({ fs: root, cwd: '/workspace', python: false, javascript: false });
}

/** Decode stored bytes as UTF-8 text. */
function text(bytes: Uint8Array | string | undefined): string | undefined {
  if (bytes === undefined || typeof bytes === 'string') return bytes;
  return Buffer.from(bytes).toString('utf8');
}

/** A change list reduced to paths, types, and text contents for comparison. */
function summary(changes: PathChange[]): Array<[string, string, string?]> {
  return changes.map((change) => change.type === 'file'
    ? [change.path, change.type, text(change.content)]
    : [change.path, change.type]);
}

describe('StoreFs', () => {
  let dir: string;
  let store: WorkspaceStore;

  /** Commit host changes directly to the store. */
  function hostCommit(changes: PathChange[]): void {
    store.commit({ kind: 'notes', turn: 1, author: 'host', changes });
  }

  /** Run one script against a fresh writable view of `game/` and return its result and touched changes. */
  async function run(script: string): Promise<{ exitCode: number; stderr: string; stdout: string; changes: PathChange[] }> {
    const view = new StoreFs(store, store.manifest(), 'game/');
    const result = await shell(view).exec(script);
    return { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout, changes: await view.touchedChanges() };
  }

  /** Run one script and commit its touched changes as a notes commit. */
  async function runAndCommit(script: string): Promise<PathChange[]> {
    const { exitCode, stderr, changes } = await run(script);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    store.commit({ kind: 'notes', turn: 1, author: 'agent', changes });
    return changes;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-store-fs-'));
    mocks.config.telemetryDir = dir;
    store = WorkspaceStore.open(path.join(dir, 'seat.db'));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('view contents', () => {
    it('should show only the prefix and load file contents from the store', async () => {
      hostCommit([
        { path: 'game/notes/a.md', type: 'file', content: 'alpha\n' },
        { path: 'records/r.md', type: 'file', content: 'record' },
      ]);
      const { stdout, changes } = await run('cat game/notes/a.md; ls game');
      expect(stdout).toBe('alpha\nnotes\n');
      expect(changes).toEqual([]);
    });

    it('should keep stored modes, times, and empty directories', async () => {
      hostCommit([
        { path: 'game/a.md', type: 'file', content: 'a', mode: 0o600, mtime: 1_000_000 },
        { path: 'game/empty', type: 'dir', mode: 0o700, mtime: 2_000_000 },
      ]);
      const view = new StoreFs(store, store.manifest(), 'game/');
      const file = await view.stat('/a.md');
      const directory = await view.stat('/empty');
      expect(file.mode & 0o777).toBe(0o600);
      expect(file.mtime.getTime()).toBe(1_000_000);
      expect(directory.isDirectory).toBe(true);
      expect(directory.mode & 0o777).toBe(0o700);
      expect(directory.mtime.getTime()).toBe(2_000_000);
    });
  });

  describe('touched changes', () => {
    beforeEach(() => {
      hostCommit([{ path: 'game/a.md', type: 'file', content: 'a line\n' }]);
    });

    it('should record redirection', async () => {
      const changes = await runAndCommit('echo hi > game/new.md');
      expect(summary(changes)).toEqual([['game/new.md', 'file', 'hi\n']]);
      expect(text(store.readFile('game/new.md'))).toBe('hi\n');
    });

    it('should record appends to a stored file', async () => {
      const changes = await runAndCommit('echo more >> game/a.md');
      expect(summary(changes)).toEqual([['game/a.md', 'file', 'a line\nmore\n']]);
    });

    it('should record tee', async () => {
      const changes = await runAndCommit('echo teed | tee game/t.md');
      expect(summary(changes)).toEqual([['game/t.md', 'file', 'teed\n']]);
    });

    it('should record sed -i', async () => {
      const changes = await runAndCommit("sed -i 's/line/row/' game/a.md");
      expect(summary(changes)).toEqual([['game/a.md', 'file', 'a row\n']]);
    });

    it('should record mkdir', async () => {
      const changes = await runAndCommit('mkdir -p game/x/y');
      expect(summary(changes)).toEqual([['game/x/y', 'dir']]);
    });

    it('should record rm -r as one delete', async () => {
      hostCommit([
        { path: 'game/d/one.md', type: 'file', content: '1' },
        { path: 'game/d/sub/two.md', type: 'file', content: '2' },
      ]);
      const changes = await runAndCommit('rm -r game/d');
      expect(summary(changes)).toEqual([['game/d', 'delete']]);
      expect([...store.manifest().keys()]).toEqual(['game/a.md']);
    });

    it('should drop old contents when a folder is removed and recreated in one command', async () => {
      hostCommit([
        { path: 'game/d/old.md', type: 'file', content: 'old' },
        { path: 'game/d/keep.md', type: 'file', content: 'keep' },
      ]);
      await runAndCommit('rm -rf game/d && mkdir game/d && echo new > game/d/new.md');
      expect([...store.manifest().keys()].sort()).toEqual(['game/a.md', 'game/d', 'game/d/new.md']);
      expect(text(store.readFile('game/d/new.md'))).toBe('new\n');
    });

    it('should record mv as a delete and a write', async () => {
      const changes = await runAndCommit('mv game/a.md game/b.md');
      expect(summary(changes)).toEqual([['game/a.md', 'delete'], ['game/b.md', 'file', 'a line\n']]);
      expect([...store.manifest().keys()]).toEqual(['game/b.md']);
    });

    it('should record cp -r with everything it copied', async () => {
      hostCommit([
        { path: 'game/src/one.md', type: 'file', content: '1' },
        { path: 'game/src/sub/two.md', type: 'file', content: '2' },
      ]);
      await runAndCommit('cp -r game/src game/dst');
      const manifest = store.manifest();
      expect(text(store.readFile('game/dst/one.md'))).toBe('1');
      expect(text(store.readFile('game/dst/sub/two.md'))).toBe('2');
      expect(manifest.get('game/dst')?.type).toBe('dir');
      expect(text(store.readFile('game/src/one.md'))).toBe('1');
    });

    it('should leave out files created and removed in one command', async () => {
      const { changes } = await run('echo tmp > game/tmp.md; rm game/tmp.md; cat game/a.md > /dev/null');
      expect(changes).toEqual([]);
    });

    it('should mark seeded paths touched', async () => {
      const seeded = new StoreFs(store, store.manifest(), 'game/');
      seeded.writeFileSync('/GUIDE.md', 'guide');
      seeded.touch('/GUIDE.md');
      expect(summary(await seeded.touchedChanges())).toEqual([['game/GUIDE.md', 'file', 'guide']]);
    });
  });

  describe('persistence into the next command', () => {
    it('should keep an empty mkdir', async () => {
      await runAndCommit('mkdir game/empty');
      const { stdout } = await run('test -d game/empty && echo yes');
      expect(stdout).toBe('yes\n');
    });

    it('should keep a chmod', async () => {
      hostCommit([{ path: 'game/a.md', type: 'file', content: 'a' }]);
      await runAndCommit('chmod 600 game/a.md');
      expect(store.manifest().get('game/a.md')?.mode).toBe(0o600);
      const view = new StoreFs(store, store.manifest(), 'game/');
      expect((await view.stat('/a.md')).mode & 0o777).toBe(0o600);
    });

    it('should keep a touch of an existing file and create a new one', async () => {
      hostCommit([{ path: 'game/a.md', type: 'file', content: 'a', mtime: 1000 }]);
      await runAndCommit('touch game/a.md game/new.md');
      const manifest = store.manifest();
      expect(manifest.get('game/a.md')?.mtime).toBeGreaterThan(1000);
      expect(text(store.readFile('game/a.md'))).toBe('a');
      expect(manifest.get('game/new.md')).toMatchObject({ type: 'file', size: 0 });
      const { stdout } = await run('ls game');
      expect(stdout).toBe('a.md\nnew.md\n');
    });

    it('should let two views from the same version both land, later writes winning per path', async () => {
      hostCommit([{ path: 'game/shared.md', type: 'file', content: 'base' }]);
      const base = store.manifest();
      const first = new StoreFs(store, base, 'game/');
      const second = new StoreFs(store, base, 'game/');
      await shell(first).exec('echo one > game/one.md; echo first > game/shared.md');
      await shell(second).exec('echo two > game/two.md; echo second > game/shared.md');
      store.commit({ kind: 'notes', turn: 1, author: 'a', changes: await first.touchedChanges() });
      store.commit({ kind: 'notes', turn: 1, author: 'b', changes: await second.touchedChanges() });
      expect(text(store.readFile('game/one.md'))).toBe('one\n');
      expect(text(store.readFile('game/two.md'))).toBe('two\n');
      expect(text(store.readFile('game/shared.md'))).toBe('second\n');
    });
  });

  describe('links', () => {
    it('should reject symbolic and hard links', async () => {
      hostCommit([{ path: 'game/a.md', type: 'file', content: 'a' }]);
      const soft = await run('ln -s a.md game/soft');
      expect(soft.exitCode).not.toBe(0);
      expect(soft.changes).toEqual([]);
      const hard = await run('ln game/a.md game/hard');
      expect(hard.exitCode).not.toBe(0);
      expect(hard.changes).toEqual([]);
    });
  });

  describe('read-only views', () => {
    /** Run a script and capture its result, or the error message when the shell throws. */
    async function outcome(filesystem: IFileSystem, script: string): Promise<{ exitCode?: number; stderr?: string; thrown?: string }> {
      try {
        const result = await shell(filesystem).exec(script);
        return { exitCode: result.exitCode, stderr: result.stderr };
      } catch (error) {
        return { thrown: (error as Error).message };
      }
    }

    it('should reject writes the same way as a read-only disk mount', async () => {
      hostCommit([{ path: 'game/a.md', type: 'file', content: 'a' }]);
      const diskRoot = path.join(dir, 'disk');
      fs.mkdirSync(diskRoot);
      fs.writeFileSync(path.join(diskRoot, 'a.md'), 'a');
      const realRoot = fs.realpathSync.native(diskRoot);

      const scripts = [
        'echo x > game/a.md',
        'echo x >> game/a.md',
        'mkdir game/d',
        'rm game/a.md',
        'touch game/a.md',
        'mv game/a.md game/b.md',
        'cp game/a.md game/b.md',
      ];
      for (const script of scripts) {
        const view = new StoreFs(store, store.manifest(), 'game/', { readOnly: true });
        const ours = await outcome(view, script);
        const disk = await outcome(new OverlayFs({ root: realRoot, readOnly: true, mountPoint: '/' }), script);
        expect(ours.exitCode ?? 1, script).not.toBe(0);
        expect({ script, ...ours }).toEqual({ script, ...disk });
        expect(await view.touchedChanges()).toEqual([]);
      }
      expect(fs.readdirSync(diskRoot)).toEqual(['a.md']);
    });

    it('should reject chmod and links', async () => {
      hostCommit([{ path: 'game/a.md', type: 'file', content: 'a' }]);
      for (const script of ['chmod 600 game/a.md', 'ln -s a.md game/link', 'ln game/a.md game/hard']) {
        const view = new StoreFs(store, store.manifest(), 'game/', { readOnly: true });
        const result = await outcome(view, script);
        expect(result.exitCode ?? 1, script).not.toBe(0);
        expect(await view.touchedChanges()).toEqual([]);
        expect((await view.stat('/a.md')).mode & 0o777).toBe(0o644);
      }
    });
  });
});
