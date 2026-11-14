import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { updateDllPin } from './update-dll-pin.mjs';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: vi.fn(), realpathSync: vi.fn(), writeFileSync: vi.fn() }));

const root = resolve('fixture');
const commit = '0123456789abcdef0123456789abcdef01234567';
const oldPin = 'RELEASE_TAG=old\nCOMMIT=old\n';
let pages;

/** Creates a complete release response with optional overrides. */
function release(overrides = {}) {
  return {
    tag_name: 'build-5.2.7-20260928-010203-0123456',
    draft: false,
    prerelease: false,
    body: `**Commit:** ${commit}\n**Branch:** vox-deorum-5.2\n`,
    assets: ['CvGameCore_Expansion2-Release.dll', 'CvGameCore_Expansion2-Debug.dll', 'version.txt']
      .map(name => ({ name, size: 100 })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  pages = [[release()]];
  realpathSync.mockImplementation(path => path);
  readFileSync.mockImplementation(path => path.endsWith('vp-lines.txt')
    ? 'DEFAULT_LINE=5.2\nLINES=5.2 5.4\n' : oldPin);
  spawnSync.mockImplementation((command, args) => {
    let output;
    if (command === 'git') output = args.includes('--show-toplevel') ? join(root, 'civ5-dll') : commit;
    else if (args[1].includes('/releases?')) output = JSON.stringify(pages[Number(args[1].match(/&page=(\d+)/)[1]) - 1] ?? []);
    else throw new Error(`Unexpected query: ${command} ${args.join(' ')}`);
    return { status: 0, stdout: output, stderr: '' };
  });
});

describe('updateDllPin', () => {
  it('pins the verified build for the checkout and default line', () => {
    const result = updateDllPin(root);
    expect(result.commit).toBe(commit);
    expect(writeFileSync).toHaveBeenCalledWith(join(root, 'scripts', 'dll-release-info-5.2.txt'),
      `RELEASE_TAG=${release().tag_name}\nCOMMIT=${commit}\n`);
    expect(spawnSync.mock.calls.filter(([command]) => command === 'git')
      .every(([, args]) => args.includes('rev-parse'))).toBe(true);
  });

  it('supports another listed line without using a different line release', () => {
    pages = [[release(), release({ tag_name: 'build-5.4.1-20260928-010203-0123456',
      body: `**Commit:** ${commit}\n**Branch:** vox-deorum-5.4\n` })]];
    const result = updateDllPin(root, '5.4');
    expect(result.tag).toContain('build-5.4.1-');
    expect(writeFileSync.mock.calls[0][0]).toBe(join(root, 'scripts', 'dll-release-info-5.4.txt'));
  });

  it('paginates past unrelated builds', () => {
    pages = [Array.from({ length: 100 }, () => release({ tag_name: 'unrelated' })), [release()]];
    expect(updateDllPin(root).changed).toBe(true);
    expect(spawnSync.mock.calls.some(([, args]) => args[1].includes('&page=2'))).toBe(true);
  });

  it.each([
    [],
    [release({ draft: true })],
    [release({ prerelease: true })],
    [release({ tag_name: 'build-5.4.1-20260928-010203-0123456' })],
    [release({ tag_name: 'build-5.2.7-20260928-010203-abcdef0' })],
    [release({ assets: [{ name: 'version.txt', size: 100 }] })],
    [release({ assets: release().assets.map(asset => ({ ...asset, size: 0 })) })],
  ])('preserves the pin when no eligible build exists (%#)', (...releases) => {
    pages = [releases];
    expect(() => updateDllPin(root)).toThrow();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it.each([
    `**Commit:** ${commit.slice(0, 7)}${'f'.repeat(33)}\n**Branch:** vox-deorum-5.2\n`,
    `**Commit:** ${commit}\n**Branch:** vox-deorum-5.4\n`,
    '',
  ])('rejects missing or mismatched build source metadata (%#)', body => {
    pages = [[release({ body })]];
    expect(() => updateDllPin(root)).toThrow();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('leaves the file untouched for dry runs and already current pins', () => {
    expect(updateDllPin(root, undefined, true).changed).toBe(true);
    readFileSync.mockImplementation(path => path.endsWith('vp-lines.txt')
      ? 'DEFAULT_LINE=5.2\nLINES=5.2\n'
      : `RELEASE_TAG=${release().tag_name}\r\nCOMMIT=${commit}\r\n`);
    expect(updateDllPin(root).changed).toBe(false);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects an unsupported line before querying GitHub', () => {
    expect(() => updateDllPin(root, '../5.2')).toThrow();
    expect(spawnSync).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects an uninitialized submodule resolving to the outer repo', () => {
    realpathSync.mockImplementationOnce(() => root);
    expect(() => updateDllPin(root)).toThrow();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('preserves the pin on a GitHub query failure', () => {
    spawnSync.mockReturnValueOnce({ status: 0, stdout: join(root, 'civ5-dll') })
      .mockReturnValueOnce({ status: 0, stdout: commit })
      .mockReturnValueOnce({ status: 1, stderr: 'API unavailable' });
    expect(() => updateDllPin(root)).toThrow();
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
