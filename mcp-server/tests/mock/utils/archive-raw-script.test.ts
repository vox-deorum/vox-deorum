import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

/** Create a temporary directory tracked for test cleanup. */
async function makeTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vox-raw-script-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('archive-raw script', () => {
  it('creates an independent ZIP with one game root and no tactical-training files', async () => {
    const root = await makeTempDirectory();
    const gameId = 'game-script-test';
    const source = join(root, gameId);
    const output = join(root, 'archive');
    await mkdir(join(source, 'baselines'), { recursive: true });
    await mkdir(join(source, 'segments', 'player-0'), { recursive: true });
    await mkdir(join(source, 'tactical-training'), { recursive: true });
    await writeFile(join(source, 'baselines', 'one.bin'), 'one');
    await writeFile(join(source, 'segments', 'player-0', 'stream.bin'), 'stream');
    await writeFile(join(source, 'tactical-training', 'derived.bin'), 'derived');

    const repositoryRoot = resolve('..');
    await execFileAsync(process.execPath, [
      join(repositoryRoot, 'scripts', 'utilities', 'archive-raw.mjs'),
      source,
      output,
    ], { cwd: repositoryRoot });

    const archive = join(output, `${gameId}.zip`);
    const { stdout } = await execFileAsync('python', ['-c',
      'import json, sys, zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps([(x.filename, x.compress_type) for x in z.infolist()]))', archive]);
    const members = JSON.parse(stdout) as Array<[string, number]>;
    expect(members).toEqual([
      [`${gameId}/baselines/one.bin`, 8],
      [`${gameId}/segments/player-0/stream.bin`, 0],
    ]);
  });
});
