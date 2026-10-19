/** Tests for the disposable replay workspace (src/utils/workspace/replay-workspace.ts). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedFilesConfig } from '../../../../src/types/config.js';

const mocks = vi.hoisted(() => ({
  config: { telemetryDir: '' },
}));

vi.mock('../../../../src/utils/config.js', () => ({ config: mocks.config }));

import { ReplayWorkspace, type ReplayWorkspaceOptions } from '../../../../src/utils/workspace/replay-workspace.js';
import { WorkspaceStore, type CommitID, type PathChange } from '../../../../src/utils/workspace/workspace-store.js';
import { workspaceGuideFile } from '../../../../src/utils/workspace/player-workspace.js';

/** A resolved files setting with defaults for the fields a test leaves out. */
function files(overrides: Partial<ResolvedFilesConfig> = {}): ResolvedFilesConfig {
  return { game: 'write', shared: {}, quota: 20, ...overrides };
}

describe('ReplayWorkspace', () => {
  let dir: string;
  let dbPath: string;
  let sharedRoot: string;
  let store: WorkspaceStore;
  const workspaces: ReplayWorkspace[] = [];

  /** Commit host changes to the seat store and return the new commit id. */
  function hostCommit(changes: PathChange[], kind: 'turn' | 'notes' = 'notes'): CommitID {
    return store.commit({ kind, turn: 1, author: 'host', changes });
  }

  /** Open a workspace for the test seat, defaulting to the current head, and record it for closing. */
  async function openWorkspace(overrides: Partial<ReplayWorkspaceOptions> = {}): Promise<ReplayWorkspace> {
    const workspace = await ReplayWorkspace.open({
      dbPath,
      files: files(),
      gameID: 'g1',
      playerID: 1,
      commit: store.head(),
      sharedRoot,
      ...overrides,
    });
    workspaces.push(workspace);
    return workspace;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-replay-workspace-'));
    mocks.config.telemetryDir = dir;
    dbPath = path.join(dir, 'strat', 'g1-player-1.db');
    sharedRoot = path.join(dir, 'workspaces', 'shared');
    // Mimic a telemetry database: spans already in the file, then the store added next to them.
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const telemetry = new Database(dbPath);
    telemetry.exec('CREATE TABLE spans (contextId TEXT, name TEXT)');
    telemetry.close();
    store = WorkspaceStore.open(dbPath);
  });

  afterEach(() => {
    for (const workspace of workspaces.splice(0)) {
      try {
        workspace.close();
      } catch {
        // The test already closed it.
      }
    }
    try {
      store.close();
    } catch {
      // The test already closed it.
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can hold the SQLite file briefly after close.
    }
  });

  it('should read the store as it was at the pinned commit', async () => {
    const atV1 = hostCommit([{ path: 'game/plan.md', type: 'file', content: 'v1' }]);
    hostCommit([{ path: 'game/plan.md', type: 'file', content: 'v2' }]);

    const older = await openWorkspace({ commit: atV1 });
    const read = await older.exec('cat /workspace/game/plan.md');
    expect(read).toMatchObject({ stdout: 'v1', exitCode: 0 });

    const head = await openWorkspace();
    expect((await head.exec('cat /workspace/game/plan.md')).stdout).toBe('v2');
  });

  it('should seed the guide at a writable game folder, keep a stored guide, and skip read-only folders', async () => {
    const init = store.history()[0].id;
    const fresh = await openWorkspace({ commit: init });
    const guide = await fresh.exec(`cat /workspace/game/${workspaceGuideFile}`);
    expect(guide.exitCode).toBe(0);
    expect(guide.stdout.length).toBeGreaterThan(0);

    hostCommit([{ path: `game/${workspaceGuideFile}`, type: 'file', content: 'custom guide' }]);
    const custom = await openWorkspace();
    expect((await custom.exec(`cat /workspace/game/${workspaceGuideFile}`)).stdout).toBe('custom guide');

    const readOnly = await openWorkspace({ commit: init, files: files({ game: 'read' }) });
    expect((await readOnly.exec(`cat /workspace/game/${workspaceGuideFile}`)).exitCode).not.toBe(0);
  });

  it('should show records and reference read-only', async () => {
    hostCommit([
      { path: 'records/turn-1/a.md', type: 'file', content: 'fact\n' },
      { path: 'reference/units.md', type: 'file', content: 'warrior\n' },
    ], 'turn');
    const workspace = await openWorkspace();
    expect((await workspace.exec('cat /workspace/records/turn-1/a.md')).stdout).toBe('fact\n');
    expect((await workspace.exec('cat /workspace/reference/units.md')).stdout).toBe('warrior\n');

    expect((await workspace.exec('echo x > /workspace/records/turn-1/a.md')).exitCode).not.toBe(0);
    expect((await workspace.exec('echo x > /workspace/reference/units.md')).exitCode).not.toBe(0);
    expect((await workspace.exec('cat /workspace/records/turn-1/a.md')).stdout).toBe('fact\n');
  });

  it('should keep writes from one command visible to the next', async () => {
    const workspace = await openWorkspace();
    expect((await workspace.exec('echo hi > /workspace/game/x.md')).exitCode).toBe(0);
    expect((await workspace.exec('cat /workspace/game/x.md')).stdout).toBe('hi\n');

    expect((await workspace.exec('echo draft > /tmp/draft.md')).exitCode).toBe(0);
    expect((await workspace.exec('cat /tmp/draft.md')).stdout).toBe('draft\n');
  });

  it('should leave the store untouched across writes and closing', async () => {
    const head = hostCommit([{ path: 'game/a.md', type: 'file', content: 'a\n' }]);
    const total = store.history().length;
    const workspace = await openWorkspace();
    await workspace.exec('echo new > /workspace/game/new.md; echo scratch > /tmp/scratch.md');
    workspace.close();

    const reopened = WorkspaceStore.open(dbPath, { readonly: true });
    try {
      expect(reopened.head()).toBe(head);
      expect(reopened.history()).toHaveLength(total);
      expect(reopened.readFile('game/new.md')).toBeUndefined();
    } finally {
      reopened.close();
    }
  });

  it('should overlay shared folders in memory and keep the disk intact', async () => {
    const lessons = path.join(sharedRoot, 'lessons');
    fs.mkdirSync(lessons, { recursive: true });
    fs.writeFileSync(path.join(lessons, 'a.md'), 'on disk\n');

    const writable = await openWorkspace({ files: files({ shared: { lessons: 'write' } }) });
    expect((await writable.exec('cat /workspace/shared/lessons/a.md')).stdout).toBe('on disk\n');
    expect((await writable.exec('echo new > /workspace/shared/lessons/b.md')).exitCode).toBe(0);
    expect((await writable.exec('cat /workspace/shared/lessons/b.md')).stdout).toBe('new\n');
    expect((await writable.exec('echo changed > /workspace/shared/lessons/a.md')).exitCode).toBe(0);
    expect((await writable.exec('cat /workspace/shared/lessons/a.md')).stdout).toBe('changed\n');

    // Nothing the writable workspace did reached the disk.
    expect(fs.readdirSync(lessons)).toEqual(['a.md']);
    expect(fs.readFileSync(path.join(lessons, 'a.md'), 'utf8')).toBe('on disk\n');

    const reader = await openWorkspace({ files: files({ shared: { lessons: 'read' } }) });
    expect((await reader.exec('cat /workspace/shared/lessons/a.md')).stdout).toBe('on disk\n');
    expect((await reader.exec('echo x > /workspace/shared/lessons/new.md')).exitCode).not.toBe(0);
    expect(fs.readdirSync(lessons)).toEqual(['a.md']);
  });

  it('should show a missing shared folder as empty', async () => {
    const writable = await openWorkspace({ files: files({ shared: { lessons: 'write' } }) });
    const listed = await writable.exec('ls /workspace/shared/lessons');
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout.split('\n').filter((name) => name && name !== workspaceGuideFile)).toEqual([]);
    expect((await writable.exec('echo lesson > /workspace/shared/lessons/new.md')).exitCode).toBe(0);
    expect(fs.existsSync(path.join(sharedRoot, 'lessons'))).toBe(false);

    const reader = await openWorkspace({ files: files({ shared: { lessons: 'read' } }) });
    const empty = await reader.exec('ls /workspace/shared/lessons');
    expect(empty.exitCode).toBe(0);
    expect(empty.stdout).toBe('');
  });

  it('should keep two workspaces opened for the same commit apart', async () => {
    const commit = hostCommit([{ path: 'game/a.md', type: 'file', content: 'base\n' }]);
    const first = await openWorkspace({ commit });
    const second = await openWorkspace({ commit });

    expect((await first.exec('echo mine > /workspace/game/mine.md')).exitCode).toBe(0);
    expect((await second.exec('cat /workspace/game/a.md')).stdout).toBe('base\n');
    expect((await second.exec('cat /workspace/game/mine.md')).exitCode).not.toBe(0);
  });

  it('should refuse to open without a store, with only spans, or at an unknown commit', async () => {
    await expect(openWorkspace({ dbPath: path.join(dir, 'strat', 'g9-player-9.db') })).rejects.toThrow();

    const spansOnly = path.join(dir, 'spans-only.db');
    const telemetry = new Database(spansOnly);
    telemetry.exec('CREATE TABLE spans (contextId TEXT, name TEXT)');
    telemetry.close();
    await expect(openWorkspace({ dbPath: spansOnly })).rejects.toThrow();

    await expect(openWorkspace({ commit: 9999 })).rejects.toThrow();
  });

  it('should fail a command whose signal was already aborted', async () => {
    const workspace = await openWorkspace();
    const controller = new AbortController();
    controller.abort();
    expect((await workspace.exec('echo hi', controller.signal)).exitCode).toBe(1);
  });
});
