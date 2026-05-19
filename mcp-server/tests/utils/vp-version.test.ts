import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { readDllCacheValue } from '../../src/utils/vp-version.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-vp-version-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('VP version cache reader', () => {
  it('reads and trims cached values', async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, 'version.txt'), '  5.2.6\r\n', 'utf-8');

    await expect(readDllCacheValue('version.txt', [dir])).resolves.toBe('5.2.6');
  });

  it('returns undefined for missing or empty files', async () => {
    const dir = await makeTempDir();
    await fs.writeFile(path.join(dir, 'version.txt'), '  \r\n', 'utf-8');

    await expect(readDllCacheValue('missing.txt', [dir])).resolves.toBeUndefined();
    await expect(readDllCacheValue('version.txt', [dir])).resolves.toBeUndefined();
  });

  it('continues through missing and empty cache directories', async () => {
    const missingDir = path.join(await makeTempDir(), 'missing');
    const emptyDir = await makeTempDir();
    const populatedDir = await makeTempDir();
    await fs.writeFile(path.join(emptyDir, 'release-tag.txt'), '', 'utf-8');
    await fs.writeFile(path.join(populatedDir, 'release-tag.txt'), 'build-20260517-163527-1267db8\n', 'utf-8');

    await expect(readDllCacheValue('release-tag.txt', [missingDir, emptyDir, populatedDir]))
      .resolves.toBe('build-20260517-163527-1267db8');
  });
});
