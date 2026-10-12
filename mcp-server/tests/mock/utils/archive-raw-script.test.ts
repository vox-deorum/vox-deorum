import { execFile, fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const archiveProcesses: ChildProcess[] = [];
const repositoryRoot = resolve('..');
const scriptPath = join(repositoryRoot, 'scripts', 'utilities', 'archive-raw.mjs');

/** Create a temporary directory tracked for test cleanup. */
async function makeTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'vox-raw-script-'));
  temporaryDirectories.push(directory);
  return directory;
}

/** Run the archive CLI with the same working directory as the MCP caller. */
function runArchive(source: string, output: string): ReturnType<typeof execFileAsync> {
  return execFileAsync(process.execPath, [scriptPath, source, output], { cwd: repositoryRoot });
}

/** Read one member of a ZIP package as text through Python's zipfile module. */
async function readZipMember(archive: string, member: string): Promise<string> {
  const { stdout } = await execFileAsync('python', ['-c',
    'import sys, zipfile; z=zipfile.ZipFile(sys.argv[1]); sys.stdout.buffer.write(z.read(sys.argv[2]))', archive, member]);
  return stdout;
}

/** Pause a real CLI process after it acquires the partial ZIP handle, before it writes. */
async function pauseArchive(root: string, source: string, output: string, failCleanup = false): Promise<{
  child: ChildProcess;
  completed: Promise<{ code: number | null; stderr: string }>;
}> {
  const preload = join(root, 'pause-output.mjs');
  await writeFile(preload, `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const originalOpen = fs.promises.open;
/** Hold the partial ZIP handle until the parent finishes checking it. */
fs.promises.open = async (...args) => {
  const handle = await originalOpen(...args);
  if (!String(args[0]).endsWith('.partial')) return handle;
  await new Promise((resolve) => {
    process.once('message', () => { process.disconnect(); resolve(); });
    process.send('archive-opened');
  });
  return handle;
};
${failCleanup ? `/** Simulate a filesystem refusing to remove the incomplete ZIP. */
fs.promises.unlink = async () => { throw new Error('EACCES'); };
` : ''}
syncBuiltinESMExports();
`);
  const child = fork(scriptPath, [source, output], {
    cwd: repositoryRoot,
    execArgv: ['--import', pathToFileURL(preload).href],
    silent: true,
  });
  archiveProcesses.push(child);
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (data: string) => { stderr += data; });
  const completed = once(child, 'close').then(([code]) => ({ code, stderr }));
  await Promise.race([
    once(child, 'message'),
    completed.then((result) => { throw new Error(`Archive exited before opening output: ${result.stderr}`); }),
  ]);
  return { child, completed };
}

afterEach(async () => {
  await Promise.all(archiveProcesses.splice(0).map(async (child) => {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }
  }));
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

    await runArchive(source, output);

    const archive = join(output, `${gameId}.zip`);
    const { stdout } = await execFileAsync('python', ['-c',
      'import json, sys, zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps([(x.filename, x.compress_type) for x in z.infolist()]))', archive]);
    const members = JSON.parse(stdout) as Array<[string, number]>;
    expect(members).toEqual([
      [`${gameId}/baselines/one.bin`, 8],
      [`${gameId}/segments/player-0/stream.bin`, 0],
    ]);
    expect(await readdir(output)).toEqual([`${gameId}.zip`]);
  });

  it('should rebuild existing output from the recording source', async () => {
    const root = await makeTempDirectory();
    const source = join(root, 'game-retry');
    const output = join(root, 'archive');
    await mkdir(source);
    await mkdir(output);
    await writeFile(join(source, 'stream.bin'), 'recording');
    const archive = join(output, 'game-retry.zip');
    await writeFile(archive, 'interrupted archive');

    await runArchive(source, output);

    expect(await readZipMember(archive, 'game-retry/stream.bin')).toBe('recording');
    expect(await readdir(output)).toEqual(['game-retry.zip']);
  });

  it.skipIf(process.platform !== 'win32')('should keep the old ZIP copyable and block copies of the partial ZIP', async () => {
    const root = await makeTempDirectory();
    const source = join(root, 'game-locked');
    const output = join(root, 'archive');
    await mkdir(source);
    await mkdir(output);
    await writeFile(join(source, 'stream.bin'), 'recording');
    const archive = join(output, 'game-locked.zip');
    await writeFile(archive, 'previous archive');
    const copied = join(root, 'copied');
    /** Copy one file out of the output directory with robocopy. */
    const robocopy = (name: string) => execFileAsync('robocopy',
      [output, copied, name, '/R:0', '/W:0', '/NJH', '/NJS', '/NP'], { windowsHide: true });
    const { child, completed } = await pauseArchive(root, source, output);
    const partialName = `.game-locked.${child.pid}.partial`;

    await expect(readFile(join(output, partialName))).rejects.toMatchObject({ code: 'EBUSY' });
    await expect(robocopy(partialName)).rejects.toMatchObject({ code: 8 });
    // Robocopy returns 1 when it successfully copies a file.
    await expect(robocopy('game-locked.zip')).rejects.toMatchObject({ code: 1 });
    expect(await readFile(join(copied, 'game-locked.zip'), 'utf8')).toBe('previous archive');

    child.send('continue');
    expect(await completed).toMatchObject({ code: 0 });
    expect(await readdir(output)).toEqual(['game-locked.zip']);
    expect(await readZipMember(archive, 'game-locked/stream.bin')).toBe('recording');
  });

  it.each([
    { failCleanup: false },
    { failCleanup: true },
  ])('should keep the old ZIP when a rebuild fails (failCleanup: $failCleanup)', async ({ failCleanup }) => {
    const root = await makeTempDirectory();
    const source = join(root, 'game-failure');
    const output = join(root, 'archive');
    await mkdir(source);
    await mkdir(output);
    const recording = join(source, 'stream.bin');
    await writeFile(recording, 'recording');
    const archive = join(output, 'game-failure.zip');
    await writeFile(archive, 'previous archive');
    const { child, completed } = await pauseArchive(root, source, output, failCleanup);
    const partialName = `.game-failure.${child.pid}.partial`;

    await unlink(recording);
    child.send('continue');

    const result = await completed;
    expect(result).toMatchObject({ code: 1 });
    expect(result.stderr).toContain('ENOENT');
    if (failCleanup) expect(result.stderr).toContain('EACCES');
    expect((await readdir(output)).sort()).toEqual(failCleanup ? [partialName, 'game-failure.zip'] : ['game-failure.zip']);
    expect(await readFile(archive, 'utf8')).toBe('previous archive');
  });
});
