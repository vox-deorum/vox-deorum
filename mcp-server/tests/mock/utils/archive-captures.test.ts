/**
 * Tests for the capture-recording collection in the archive utility
 * (src/utils/knowledge/archive.ts). With VOX_RL_CAPTURE=1 the game DLL writes
 * an RL recording tree under the Civ V user folder and finalizes it (final
 * commit, handles released) when the victory event fires; the archive then
 * moves the whole tree into archive/<experiment>/captures/<game-id>/, falls
 * back to a copy when the rename is not possible, and logs the outcome
 * without ever failing the rest of the archive.
 *
 * The outside seams archive.ts touches — the Documents path, the
 * knowledgeManager singleton, and (to force the rename/copy failure paths)
 * fs rename/cp — are replaced with in-test fakes; everything else runs
 * against real temp directories.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Mutable state shared with the hoisted vi.mock factories below. */
const mockEnv = vi.hoisted(() => ({
  documentsPath: '',
  gameId: 'game-1',
  failRename: false,
  failCp: false,
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const defaultExport = (actual as unknown as { default?: typeof actual }).default ?? actual;
  return {
    ...actual,
    default: {
      ...defaultExport,
      // Renames fail for real reasons (a cross-volume archive, or the DLL
      // still holding the files open); tests force those paths here.
      rename: async (...args: Parameters<typeof defaultExport.rename>) => {
        if (mockEnv.failRename) throw new Error('EPERM: rename forced to fail by the test');
        return defaultExport.rename(...args);
      },
      cp: async (...args: Parameters<typeof defaultExport.cp>) => {
        if (mockEnv.failCp) throw new Error('EACCES: cp forced to fail by the test');
        return defaultExport.cp(...args);
      },
    },
  };
});

vi.mock('../../../src/utils/config.js', () => ({
  getDocumentsPath: vi.fn(async () => mockEnv.documentsPath),
}));

vi.mock('../../../src/server.js', () => ({
  knowledgeManager: {
    getStore: () => ({ getMetadata: async () => undefined }),
    getGameId: () => mockEnv.gameId,
  },
}));

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { archiveGameData, collectCaptureRecording } from '../../../src/utils/knowledge/archive.js';

const tempDirs: string[] = [];

/** Create a temp directory that is removed after each test. */
async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-archive-captures-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  mockEnv.failRename = false;
  mockEnv.failCp = false;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/** The per-game capture root inside the mocked Documents folder. */
const captureRoot = (gameId: string) =>
  path.join(mockEnv.documentsPath, 'My Games', "Sid Meier's Civilization 5", 'VoxDeorumRL', gameId);

/** Write one file (creating parent directories) under a root. */
async function writeFileUnder(root: string, relativePath: string, content: string | Buffer): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

/**
 * Write a small but realistic recording tree: two baselines and one
 * committed segment, exactly as the DLL leaves it after finalizing.
 */
async function writeRecording(gameId: string): Promise<void> {
  await writeFileUnder(captureRoot(gameId), 'baselines/static/static-1.bin', 'STATIC');
  await writeFileUnder(captureRoot(gameId), 'baselines/campaign/player-0/turn-3/campaign-1.bin', 'CAMPAIGN');
  await writeFileUnder(captureRoot(gameId), 'segments/player-0/turn-3/world-1/index.jsonl', '{"type":"segment"}\n{"type":"commit"}\n');
  await writeFileUnder(captureRoot(gameId), 'segments/player-0/turn-3/world-1/stream.bin', Buffer.from([1, 2, 3, 4]));
}

describe('collectCaptureRecording', () => {
  let capturesPath: string;

  beforeEach(async () => {
    mockEnv.documentsPath = await makeTempDir();
    capturesPath = path.join(await makeTempDir(), 'captures');
  });

  it('reports absent and archives nothing when the game has no capture root', async () => {
    const result = await collectCaptureRecording('missing-game', capturesPath);

    expect(result).toEqual({ moved: false, status: 'absent' });
    await expect(fs.access(path.join(capturesPath, 'missing-game'))).rejects.toThrow();
  });

  it('moves the whole recording tree into the archive and removes the source', async () => {
    const gameId = mockEnv.gameId;
    await writeRecording(gameId);

    const result = await collectCaptureRecording(gameId, capturesPath);

    expect(result).toEqual({ moved: true, status: 'ok' });
    // The recording is no longer in the Civ V user folder...
    await expect(fs.access(captureRoot(gameId))).rejects.toThrow();
    // ...and the whole tree landed intact: baselines and the segment pair.
    const dest = path.join(capturesPath, gameId);
    await expect(fs.readFile(path.join(dest, 'baselines/static/static-1.bin'), 'utf-8')).resolves.toBe('STATIC');
    await expect(fs.readFile(path.join(dest, 'baselines/campaign/player-0/turn-3/campaign-1.bin'), 'utf-8')).resolves.toBe('CAMPAIGN');
    await expect(fs.readFile(path.join(dest, 'segments/player-0/turn-3/world-1/index.jsonl'), 'utf-8')).resolves.toContain('"type":"commit"');
    const destStream = await fs.readFile(path.join(dest, 'segments/player-0/turn-3/world-1/stream.bin'));
    expect(Buffer.from(destStream).equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
  });

  it('replaces a stale destination left by an earlier attempt', async () => {
    const gameId = mockEnv.gameId;
    await writeRecording(gameId);
    await writeFileUnder(capturesPath, path.join(gameId, 'junk', 'stale.txt'), 'STALE');

    const result = await collectCaptureRecording(gameId, capturesPath);

    expect(result).toEqual({ moved: true, status: 'ok' });
    await expect(fs.access(path.join(capturesPath, gameId, 'junk'))).rejects.toThrow();
    await expect(fs.access(path.join(capturesPath, gameId, 'baselines/static/static-1.bin'))).resolves.toBeUndefined();
  });

  it('falls back to a copy when the rename fails, leaving the source in place', async () => {
    const gameId = mockEnv.gameId;
    mockEnv.failRename = true;
    await writeRecording(gameId);

    const result = await collectCaptureRecording(gameId, capturesPath);

    expect(result).toEqual({ moved: false, status: 'ok' });
    // The source recording stays in the Civ V user folder...
    await expect(fs.readFile(path.join(captureRoot(gameId), 'baselines/static/static-1.bin'), 'utf-8')).resolves.toBe('STATIC');
    // ...and the destination tree is complete.
    await expect(fs.readFile(path.join(capturesPath, gameId, 'segments/player-0/turn-3/world-1/index.jsonl'), 'utf-8')).resolves.toContain('"type":"commit"');
  });

  it('reports failed without throwing when both move and copy are impossible', async () => {
    const gameId = mockEnv.gameId;
    mockEnv.failRename = true;
    mockEnv.failCp = true;
    await writeRecording(gameId);

    const result = await collectCaptureRecording(gameId, capturesPath);

    expect(result.moved).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.detail).toBeTruthy();
    // The source is untouched.
    await expect(fs.access(captureRoot(gameId))).resolves.toBeUndefined();
  });
});

describe('archiveGameData capture wiring', () => {
  const originalCwd = process.cwd();
  let workDir: string;

  beforeEach(async () => {
    workDir = await makeTempDir();
    mockEnv.documentsPath = await makeTempDir();
    process.chdir(workDir);
    // A save file so archiveGameData gets past its save-file requirement.
    await writeFileUnder(mockEnv.documentsPath, path.join('My Games', "Sid Meier's Civilization 5", 'ModdedSaves', 'single', 'auto', 'auto.Civ5Save'), 'SAVE');
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('moves the recording under archive/<experiment>/captures/<game-id> without changing the return shape', async () => {
    const gameId = mockEnv.gameId;
    await writeRecording(gameId);

    const result = await archiveGameData('exp-test');

    expect(result).not.toBeNull();
    // The capture outcome is only logged — the return shape is unchanged.
    expect(result).not.toHaveProperty('captures');
    await expect(fs.access(path.join(workDir, 'archive', 'exp-test', 'captures', gameId, 'segments', 'player-0', 'turn-3', 'world-1', 'index.jsonl'))).resolves.toBeUndefined();
    // The recording moved out of the Civ V user folder.
    await expect(fs.access(captureRoot(gameId))).rejects.toThrow();
    await expect(fs.access(result!.savePath)).resolves.toBeUndefined();
  });

  it('creates no captures directory when the game has no capture root', async () => {
    const result = await archiveGameData('exp-test');

    expect(result).not.toBeNull();
    await expect(fs.access(path.join(workDir, 'archive', 'exp-test', 'captures'))).rejects.toThrow();
    await expect(fs.access(result!.savePath)).resolves.toBeUndefined();
  });

  it('keeps archiving the save when capture collection fails', async () => {
    const gameId = mockEnv.gameId;
    mockEnv.failRename = true;
    mockEnv.failCp = true;
    await writeRecording(gameId);

    const result = await archiveGameData('exp-test');

    // The capture failure did not take the rest of the archive down.
    expect(result).not.toBeNull();
    await expect(fs.access(result!.savePath)).resolves.toBeUndefined();
  });
});
