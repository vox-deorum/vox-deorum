/** Tests for player workspaces backed by just-bash and the seat store (src/utils/workspace/player-workspace.ts). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedFilesConfig } from '../../../src/types/config.js';

const mocks = vi.hoisted(() => ({
  config: { telemetryDir: '' },
}));

vi.mock('../../../src/utils/config.js', () => ({ config: mocks.config }));

import {
  PlayerWorkspace,
  workspaceGuideFile,
  workspaceNodeSupported,
  workspaceOutputLimit,
  workspaceRoot,
  workspaceWritable,
} from '../../../src/utils/workspace/player-workspace.js';
import { WorkspaceStore } from '../../../src/utils/workspace/workspace-store.js';

/** A resolved files setting with defaults for the fields a test leaves out. */
function files(overrides: Partial<ResolvedFilesConfig> = {}): ResolvedFilesConfig {
  return { game: 'write', shared: {}, quota: 20, ...overrides };
}

/** Decode stored bytes as UTF-8 text. */
function text(bytes: Uint8Array | undefined): string | undefined {
  return bytes === undefined ? undefined : Buffer.from(bytes).toString('utf8');
}

describe('workspaceNodeSupported', () => {
  it('should reject Node 22 releases before 22.17.0 and accept later ones', () => {
    expect(workspaceNodeSupported('22.12.0')).toBe(false);
    expect(workspaceNodeSupported('22.16.9')).toBe(false);
    expect(workspaceNodeSupported('20.19.0')).toBe(false);
    expect(workspaceNodeSupported('22.17.0')).toBe(true);
    expect(workspaceNodeSupported('22.23.3')).toBe(true);
    expect(workspaceNodeSupported('24.1.0')).toBe(true);
  });
});

describe('workspaceWritable', () => {
  it('should be true when the game folder or any shared folder is writable', () => {
    expect(workspaceWritable(files())).toBe(true);
    expect(workspaceWritable(files({ game: 'read', shared: { lessons: 'write' } }))).toBe(true);
    expect(workspaceWritable(files({ game: 'read', shared: { lessons: 'read' } }))).toBe(false);
    expect(workspaceWritable(files({ game: false }))).toBe(false);
  });
});

describe('PlayerWorkspace', () => {
  let telemetryDir: string;
  const stores: WorkspaceStore[] = [];

  /** Open a store outside the workspace root, so tests can check what the workspace creates. */
  function openStore(name = 'seat'): WorkspaceStore {
    const store = WorkspaceStore.open(path.join(telemetryDir, `${name}.db`));
    stores.push(store);
    return store;
  }

  /** A workspace over a store. */
  function workspace(store: WorkspaceStore, setting = files(), gameID = 'g1', playerID = 0): PlayerWorkspace {
    return new PlayerWorkspace(setting, gameID, playerID, store);
  }

  beforeEach(() => {
    telemetryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-workspace-'));
    mocks.config.telemetryDir = telemetryDir;
  });

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    fs.rmSync(telemetryDir, { recursive: true, force: true });
  });

  it('should list mounts without creating folders before the first command', () => {
    const shell = workspace(openStore(), files({ shared: { lessons: 'read' } }));
    expect(shell.mounts.map((mount) => [mount.virtualPath, mount.access])).toEqual([
      ['/tmp', 'write'],
      ['/workspace/records', 'read'],
      ['/workspace/reference', 'read'],
      ['/workspace/game', 'write'],
      ['/workspace/shared/lessons', 'read'],
    ]);
    expect(fs.existsSync(workspaceRoot())).toBe(false);
  });

  it('should reject a game ID that would leave the games folder', () => {
    expect(() => workspace(openStore(), files(), '../escape')).toThrow();
  });

  it('should reject a shared name that would leave the shared folder', () => {
    expect(() => workspace(openStore(), files({ shared: { '../games': 'write' } }))).toThrow();
  });

  describe('store views', () => {
    it('should commit note changes and show them to the next command with host commits made in between', async () => {
      const store = openStore();
      const shell = workspace(store);
      expect((await shell.exec('echo plan > game/notes.md')).exitCode).toBe(0);
      expect(text(store.readFile('game/notes.md'))).toBe('plan\n');

      store.commit({ kind: 'notes', turn: 3, author: 'host', changes: [{ path: 'game/host.md', type: 'file', content: 'host note\n' }] });
      store.commit({ kind: 'turn', turn: 3, author: 'host', changes: [{ path: 'records/turn-3/a.md', type: 'file', content: 'fact\n' }] });

      const next = await shell.exec('cat game/notes.md game/host.md records/turn-3/a.md');
      expect(next.stdout).toBe('plan\nhost note\nfact\n');
    });

    it('should record the command turn and author on one notes commit', async () => {
      const store = openStore();
      await workspace(store).exec('echo a > game/a.md; echo b > game/b.md', undefined, { turn: 7, author: 'simple-strategist' });
      const notes = store.history().filter((commit) => commit.kind === 'notes');
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ turn: 7, author: 'simple-strategist' });
    });

    describe('journal', () => {
      /** Append text to the journal in one command at a turn. */
      async function append(shell: PlayerWorkspace, body: string, turn: number | null): Promise<void> {
        const result = await shell.exec(`cat >> game/journal.md <<'EOF'\n${body}\nEOF`, undefined, { turn, author: 'simple-strategist' });
        expect(result.exitCode).toBe(0);
      }

      /** The turn numbers of the journal's turn headings, in order. */
      function headings(store: WorkspaceStore): number[] {
        return [...(text(store.readFile('game/journal.md')) ?? '').matchAll(/^### Turn (\d+)$/gm)].map((match) => Number(match[1]));
      }

      it('should add one turn heading per turn to appends', async () => {
        const store = openStore();
        const shell = workspace(store);
        await append(shell, 'first', 5);
        await append(shell, 'second', 5);
        await append(shell, 'third', 6);
        expect(headings(store)).toEqual([5, 6]);
        const journal = text(store.readFile('game/journal.md'))!;
        expect(journal.indexOf('first')).toBeLessThan(journal.indexOf('second'));
        expect(journal.indexOf('### Turn 6')).toBeLessThan(journal.indexOf('third'));
      });

      it('should demote shallow headings in appended text below the turn heading', async () => {
        const store = openStore();
        await append(workspace(store), '# Plan\n## Threats\n#### Detail\n```\n# comment\n```', 5);
        const journal = text(store.readFile('game/journal.md'))!;
        expect(journal).toMatch(/^#### Plan$/m);
        expect(journal).toMatch(/^#### Threats$/m);
        expect(journal).toMatch(/^#### Detail$/m);
        expect(journal).toMatch(/^# comment$/m);
      });

      it('should commit rewrites, deletions, and appends without a turn as written', async () => {
        const store = openStore();
        const shell = workspace(store);
        await append(shell, 'kept', null);
        expect(text(store.readFile('game/journal.md'))).toBe('kept\n');
        await shell.exec('echo rewritten > game/journal.md', undefined, { turn: 5 });
        expect(text(store.readFile('game/journal.md'))).toBe('rewritten\n');
        await shell.exec('rm game/journal.md', undefined, { turn: 5 });
        expect(store.readFile('game/journal.md')).toBeUndefined();
      });

      it('should leave other note files unchanged', async () => {
        const store = openStore();
        await workspace(store).exec('echo "# Plan" >> game/plan.md', undefined, { turn: 5 });
        expect(text(store.readFile('game/plan.md'))).toBe('# Plan\n');
      });
    });

    it('should make no commit for a command that changes nothing once the guide exists', async () => {
      const store = openStore();
      const shell = workspace(store);
      await shell.exec('true');
      const head = store.head();
      await shell.exec('cat game/AGENTS.md > /dev/null');
      expect(store.head()).toBe(head);
    });

    it('should leave head unchanged when the run is cancelled during the command', async () => {
      const store = openStore();
      const shell = workspace(store);
      await shell.exec('true');
      const head = store.head();

      const controller = new AbortController();
      const pending = shell.exec('echo lost > game/lost.md; sleep 2; echo late > game/late.md', controller.signal);
      setTimeout(() => controller.abort(), 50);
      const result = await pending;

      expect(result.exitCode).toBe(1);
      expect(store.head()).toBe(head);
      expect(store.readFile('game/lost.md')).toBeUndefined();
    });

    it('should leave head unchanged when the run was cancelled before the command', async () => {
      const store = openStore();
      const head = store.head();
      const controller = new AbortController();
      controller.abort();
      const result = await workspace(store).exec('echo lost > game/lost.md', controller.signal);
      expect(result.exitCode).toBe(1);
      expect(store.head()).toBe(head);
    });

    it('should show records read-only', async () => {
      const store = openStore();
      store.commit({ kind: 'turn', turn: 1, author: 'host', changes: [{ path: 'records/turn-1/a.md', type: 'file', content: 'fact\n' }] });
      const shell = workspace(store);
      expect((await shell.exec('cat records/turn-1/a.md')).stdout).toBe('fact\n');

      const head = store.head();
      const write = await shell.exec('echo x > records/turn-1/a.md');
      expect(write.exitCode).not.toBe(0);
      expect(text(store.readFile('records/turn-1/a.md'))).toBe('fact\n');
      // The refused command commits nothing, not even the guide.
      expect(store.head()).toBe(head);
    });

    it('should show read-only notes without seeding a guide', async () => {
      const store = openStore();
      store.commit({ kind: 'notes', turn: 1, author: 'host', changes: [{ path: 'game/a.md', type: 'file', content: 'note\n' }] });
      const shell = workspace(store, files({ game: 'read' }));
      expect((await shell.exec('cat game/a.md')).stdout).toBe('note\n');
      expect((await shell.exec('echo x > game/b.md')).exitCode).not.toBe(0);
      expect(store.readFile(`game/${workspaceGuideFile}`)).toBeUndefined();
    });

    it('should leave out the notes mount without game access', async () => {
      const store = openStore();
      const result = await workspace(store, files({ game: false })).exec('ls game');
      expect(result.exitCode).not.toBe(0);
      expect(store.history().filter((commit) => commit.kind === 'notes')).toHaveLength(0);
    });

    it('should keep players apart', async () => {
      await workspace(openStore('p0'), files(), 'g1', 0).exec('echo mine > game/secret.md');
      const other = await workspace(openStore('p1'), files(), 'g1', 1).exec('cat game/secret.md');
      expect(other.exitCode).not.toBe(0);
      expect(other.stdout).toBe('');
    });

    it('should truncate long output', async () => {
      const lines = Array.from({ length: workspaceOutputLimit }, (_, index) => `${index + 1}\n`).join('');
      const result = await workspace(openStore()).exec(`seq 1 ${workspaceOutputLimit}`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.startsWith(lines.slice(0, workspaceOutputLimit))).toBe(true);
      expect(result.stdout.length).toBeLessThan(lines.length);
    });
  });

  describe('javascript', () => {
    it('should compute over records and commit notes written through fs', async () => {
      const store = openStore();
      store.commit({ kind: 'turn', turn: 1, author: 'host', changes: [{ path: 'records/turn-1/yields.json', type: 'file', content: '[3, 4.5]' }] });
      const script = `const fs = require('fs');
const values = JSON.parse(fs.readFileSync('records/turn-1/yields.json', 'utf8'));
const mean = values.reduce((a, b) => a + b, 0) / values.length;
fs.writeFileSync('game/mean.md', String(mean));
console.log(mean);`;
      const result = await workspace(store).exec(`cat > /tmp/mean.js <<'EOF'\n${script}\nEOF\njs-exec /tmp/mean.js`);

      expect(result.stdout).toBe('3.75\n');
      expect(text(store.readFile('game/mean.md'))).toBe('3.75');
    });

    it('should refuse writes to read-only mounts', async () => {
      const store = openStore();
      store.commit({ kind: 'turn', turn: 1, author: 'host', changes: [{ path: 'records/turn-1/a.md', type: 'file', content: 'fact\n' }] });
      const shell = workspace(store);
      await shell.exec('true');
      const head = store.head();
      const result = await shell.exec(`js-exec -c "require('fs').writeFileSync('records/turn-1/a.md', 'x')"`);

      expect(result.exitCode).not.toBe(0);
      expect(text(store.readFile('records/turn-1/a.md'))).toBe('fact\n');
      expect(store.head()).toBe(head);
    });

    it('should keep scripts off the real disk and the network', async () => {
      const outside = path.join(telemetryDir, 'outside.txt');
      fs.writeFileSync(outside, 'secret');
      const shell = workspace(openStore());
      const read = await shell.exec(`js-exec -c "console.log(require('fs').readFileSync(${JSON.stringify(outside)}, 'utf8'))"`);
      const fetched = await shell.exec(`js-exec -c "await fetch('https://example.com'); console.log('reached')"`);

      expect(read.stdout).not.toContain('secret');
      expect(fetched.stdout).not.toContain('reached');
    });

    it('should discard note changes when the run is cancelled during a script', async () => {
      const store = openStore();
      const shell = workspace(store);
      await shell.exec('true');
      const head = store.head();

      const controller = new AbortController();
      const pending = shell.exec(`js-exec -c "require('fs').writeFileSync('game/lost.md', 'x'); while (true) {}"`, controller.signal);
      setTimeout(() => controller.abort(), 200);
      const result = await pending;

      expect(result.exitCode).toBe(1);
      expect(store.head()).toBe(head);
    });
  });

  describe('game guide', () => {
    const guidePath = `game/${workspaceGuideFile}`;

    it('should commit the guide with a new seat\'s first command', async () => {
      const store = openStore();
      await workspace(store).exec('true', undefined, { turn: 0, author: 'simple-strategist' });
      const guide = text(store.readFile(guidePath));
      expect(guide).toBeDefined();
      expect(guide!.length).toBeGreaterThan(0);
      expect(store.history().at(-1)).toMatchObject({ kind: 'notes', author: 'simple-strategist' });
    });

    it('should reseed the guide after a rewind to before it existed', async () => {
      const store = openStore();
      store.commit({ kind: 'turn', turn: 1, author: 'host', changes: [{ path: 'records/turn-1/a.md', type: 'file', content: 'fact\n' }] });
      const shell = workspace(store);
      await shell.exec('true');
      expect(store.readFile(guidePath)).toBeDefined();

      expect(store.rewind(1)).toBe(true);
      expect(store.readFile(guidePath)).toBeUndefined();
      await shell.exec('true');
      const guide = text(store.readFile(guidePath));
      expect(guide).toBeDefined();
      expect(guide!.length).toBeGreaterThan(0);
    });

    it('should never overwrite an edited guide', async () => {
      const store = openStore();
      const shell = workspace(store);
      await shell.exec(`echo edited > game/${workspaceGuideFile}`);
      await shell.exec('true');
      expect(text(store.readFile(guidePath))).toBe('edited\n');
    });

    it('should seed a different guide when the seat can write a shared folder', async () => {
      const store = openStore();
      const sharedFiles = files({ shared: { lessons: 'write' } });
      const shell = workspace(store, sharedFiles);
      await shell.exec('true');
      const writableGuide = text(store.readFile(guidePath));
      expect(writableGuide).toBeDefined();
      expect(writableGuide!.length).toBeGreaterThan(0);
      const sharedGuide = await shell.exec('cat shared/lessons/AGENTS.md');
      expect(sharedGuide.exitCode).toBe(0);
      expect(sharedGuide.stdout.length).toBeGreaterThan(0);

      const readOnlyStore = openStore('read-only-shared');
      const readOnlyShell = workspace(readOnlyStore, files({ shared: { lessons: 'read' } }));
      await readOnlyShell.exec('true');
      const readOnlyGuide = text(readOnlyStore.readFile(guidePath));
      expect(readOnlyGuide).toBeDefined();
      expect(readOnlyGuide!.length).toBeGreaterThan(0);
      expect(readOnlyGuide).not.toBe(writableGuide);

      const noSharedStore = openStore('no-shared');
      await workspace(noSharedStore, files()).exec('true');
      expect(text(noSharedStore.readFile(guidePath))).toBe(readOnlyGuide);
    });
  });

  describe('game reference', () => {
    it('should show the stored reference read-only and leave nothing on disk', async () => {
      const store = openStore();
      const shell = workspace(store);
      expect((await shell.exec('ls reference')).stdout).toBe('');

      store.commit({ kind: 'reference', turn: null, author: 'host', changes: [{ path: 'reference/units/ancient.md', type: 'file', content: 'warrior\n' }] });
      expect((await shell.exec('cat reference/units/ancient.md')).stdout).toBe('warrior\n');

      const head = store.head();
      const write = await shell.exec('echo x > reference/units/ancient.md');
      expect(write.exitCode).not.toBe(0);
      expect(text(store.readFile('reference/units/ancient.md'))).toBe('warrior\n');
      expect(store.head()).toBe(head);
      expect(fs.existsSync(path.join(workspaceRoot(), 'games'))).toBe(false);
    });
  });

  describe.skipIf(!workspaceNodeSupported())('on disk', () => {
    it('should refuse writes to a read mount without changing disk', async () => {
      const sharedDir = path.join(workspaceRoot(), 'shared', 'reference');
      fs.mkdirSync(sharedDir, { recursive: true });
      fs.writeFileSync(path.join(sharedDir, 'doc.md'), 'reference\n');

      const shell = workspace(openStore(), files({ game: false, shared: { reference: 'read' } }));
      expect((await shell.exec('cat shared/reference/doc.md')).stdout).toBe('reference\n');
      const write = await shell.exec('echo x > shared/reference/new.md');
      expect(write.exitCode).not.toBe(0);
      expect(write.stderr).not.toBe('');
      expect(fs.readdirSync(sharedDir)).toEqual(['doc.md']);
    });

    it('should show one shared folder to two games', async () => {
      const setting = files({ shared: { lessons: 'write' } });
      await workspace(openStore('a'), setting, 'g1', 0).exec('echo lesson > shared/lessons/one.md');
      expect((await workspace(openStore('b'), setting, 'g2', 3).exec('cat shared/lessons/one.md')).stdout).toBe('lesson\n');
    });

    it('should keep escape attempts off the real disk', async () => {
      const outside = path.join(telemetryDir, 'outside.txt');
      fs.writeFileSync(outside, 'outside\n');
      const shell = workspace(openStore());

      const hostPath = outside.split(path.sep).join('/');
      const read = await shell.exec(`cat game/../../../outside.txt; cat '${outside}'; cat '${hostPath}'; cat /${hostPath}`);
      expect(read.stdout).not.toContain('outside');

      await shell.exec('echo pwn > game/../../escape.txt; echo pwn > ../escape2.txt; echo pwn > /tmp/../../escape3.txt');
      const created = fs.readdirSync(telemetryDir, { recursive: true }).map(String);
      expect(created.filter((entry) => entry.includes('escape'))).toEqual([]);
    });

    it('should keep scratch files for one player through the game and nothing else between calls', async () => {
      const store = openStore();
      const first = workspace(store);
      await first.exec('echo draft > /tmp/draft.md; echo lost > /home/lost.md');
      const later = await first.exec('cat /tmp/draft.md; cat /home/lost.md');
      expect(later.stdout).toBe('draft\n');
      expect(later.exitCode).not.toBe(0);

      expect((await workspace(store, files(), 'g1', 0).exec('cat /tmp/draft.md')).stdout).toBe('draft\n');
      expect((await workspace(openStore('p1'), files(), 'g1', 1).exec('cat /tmp/draft.md')).stdout).toBe('');
      expect((await workspace(openStore('g2'), files(), 'g2', 0).exec('cat /tmp/draft.md')).stdout).toBe('');
    });

    it('should seed shared guides once at writable roots and never overwrite them', async () => {
      const setting = files({ shared: { lessons: 'write', reference: 'read' } });
      await workspace(openStore(), setting).exec('true');

      const sharedGuide = path.join(workspaceRoot(), 'shared', 'lessons', workspaceGuideFile);
      expect(fs.existsSync(sharedGuide)).toBe(true);
      expect(fs.existsSync(path.join(workspaceRoot(), 'shared', 'reference', workspaceGuideFile))).toBe(false);

      fs.writeFileSync(sharedGuide, 'edited by an agent\n');
      await workspace(openStore('again'), setting).exec('true');
      expect(fs.readFileSync(sharedGuide, 'utf8')).toBe('edited by an agent\n');
    });
  });
});
