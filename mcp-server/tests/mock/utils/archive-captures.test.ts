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
  failRawArchive: false,
  rawArchiveArgs: [] as unknown[],
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn((...args: unknown[]) => {
    mockEnv.rawArchiveArgs = args.slice(0, 3);
    const callback = args.at(-1) as (error: Error | null, result?: { stdout: string; stderr: string }) => void;
    if (mockEnv.failRawArchive) callback(new Error('raw archive forced to fail by the test'));
    else callback(null, { stdout: '', stderr: '' });
    return {};
  }),
}));

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
import { archiveGameData } from '../../../src/utils/knowledge/archive.js';

const tempDirs: string[] = [];

/** Create a temp directory that is removed after each test. */
async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-archive-captures-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  mockEnv.failRawArchive = false;
  mockEnv.rawArchiveArgs = [];
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

  it('publishes the recording through the recording archive script', async () => {
    const gameId = mockEnv.gameId;
    await writeRecording(gameId);

    const result = await archiveGameData('exp-test');

    expect(result).not.toBeNull();
    // The raw package command is the only capture archive output.
    expect(result).not.toHaveProperty('captures');
    expect(mockEnv.rawArchiveArgs[0]).toBe(process.execPath);
    expect(mockEnv.rawArchiveArgs[1]).toEqual(expect.arrayContaining([
      path.join(workDir, 'archive', 'exp-test'),
      captureRoot(gameId),
    ]));
    await expect(fs.access(captureRoot(gameId))).resolves.toBeUndefined();
    await expect(fs.access(path.join(workDir, 'archive', 'exp-test', 'captures'))).rejects.toThrow();
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
    mockEnv.failRawArchive = true;
    await writeRecording(gameId);

    const result = await archiveGameData('exp-test');

    // The capture failure did not take the rest of the archive down.
    expect(result).not.toBeNull();
    await expect(fs.access(result!.savePath)).resolves.toBeUndefined();
  });

  it('keeps the finalized source when raw package publication fails', async () => {
    const gameId = mockEnv.gameId;
    mockEnv.failRawArchive = true;
    await writeRecording(gameId);

    const result = await archiveGameData('exp-test');

    expect(result).not.toBeNull();
    await expect(fs.access(captureRoot(gameId))).resolves.toBeUndefined();
    await expect(fs.access(path.join(workDir, 'archive', 'exp-test', 'captures'))).rejects.toThrow();
    await expect(fs.access(result!.savePath)).resolves.toBeUndefined();
  });
});
