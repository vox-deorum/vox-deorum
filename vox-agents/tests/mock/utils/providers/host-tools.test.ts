/** Tests for the shared host meta-tool policy. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  everythingHostTools,
  hostWorkspaceGuideFiles,
  resolveHostToolAccess,
  resolveHostToolCapabilities,
  seedHostWorkspaceGuide,
} from '../../../../src/utils/models/providers/host-tools.js';

const base = path.join(os.tmpdir(), 'vox-host-tools-test');
const outside = path.join(os.tmpdir(), 'vox-host-tools-outside');

/** Removes temporary directories created by host-tool access tests. */
function removeTestDirectory(): void {
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}

describe('resolveHostToolAccess', () => {
  afterEach(removeTestDirectory);

  it('denies missing or empty host tools without creating a directory', () => {
    expect(resolveHostToolAccess(undefined, { workingDirectoryBase: base, workingDirId: 'empty' }))
      .toEqual({ read: false, write: false, web: false });
    expect(resolveHostToolAccess([], { workingDirectoryBase: base, workingDirId: 'empty' }))
      .toEqual({ read: false, write: false, web: false });
    expect(fs.existsSync(base)).toBe(false);
  });

  it('expands everything into every capability inside a scoped directory', () => {
    const access = resolveHostToolAccess([everythingHostTools], {
      workingDirectoryBase: base,
      workingDirId: 'game-player',
    });
    expect(access).toEqual({
      read: true,
      write: true,
      web: true,
      workingDirectory: path.join(base, 'game-player'),
    });
    expect(fs.existsSync(access.workingDirectory!)).toBe(true);
  });

  it('grants read through write while leaving web disabled', () => {
    const access = resolveHostToolAccess(['Write'], { workingDirectoryBase: base, workingDirId: 'writer' });
    expect(access).toEqual({
      read: true,
      write: true,
      web: false,
      workingDirectory: path.join(base, 'writer'),
    });
    expect(fs.existsSync(access.workingDirectory!)).toBe(true);
  });

  it('keeps explicit read and web selections free of write access', () => {
    const access = resolveHostToolAccess(['Read', 'Web'], { workingDirectoryBase: base });
    expect(access).toEqual({
      read: true,
      write: false,
      web: true,
      workingDirectory: path.join(base, 'default'),
    });
  });

  it('keeps the default working directory for Web-only provider access', () => {
    const access = resolveHostToolAccess(['Web'], { workingDirectoryBase: base, workingDirId: 'web-only' });

    expect(access).toEqual({
      read: false,
      write: false,
      web: true,
      workingDirectory: path.join(base, 'web-only'),
    });
    expect(fs.existsSync(access.workingDirectory!)).toBe(true);
  });

  it('does not create a working directory when Web is outside the provider policy', () => {
    const access = resolveHostToolAccess(['Web'], {
      workingDirectoryBase: base,
      workingDirId: 'codex-web-only',
      workingDirectoryTools: ['Read', 'Write'],
    });

    expect(access).toEqual({ read: false, write: false, web: true });
    expect(fs.existsSync(base)).toBe(false);
  });

  it('fails fast on names outside the meta-tool vocabulary', () => {
    for (const requested of [['Bash'], ['Glob'], ['Read', 'Bash'], [everythingHostTools, 'Read']]) {
      expect(() => resolveHostToolAccess(requested, { workingDirectoryBase: base }))
        .toThrow('Unsupported hostTools entries');
    }
    expect(fs.existsSync(base)).toBe(false);
  });

  it('rejects a lexical working-directory escape before creating the provider root', () => {
    expect(() => resolveHostToolAccess(['Read'], {
      workingDirectoryBase: base,
      workingDirId: path.join('..', 'outside'),
    })).toThrow('must remain under provider root');

    expect(fs.existsSync(base)).toBe(false);
  });

  it('rejects an existing link that resolves outside the provider root', () => {
    const linkedDirectory = path.join(base, 'linked');
    fs.mkdirSync(base, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.symlinkSync(outside, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => resolveHostToolAccess(['Read'], {
      workingDirectoryBase: base,
      workingDirId: path.join('linked', 'game-player'),
    })).toThrow('resolves outside provider root');
  });
});

describe('resolveHostToolCapabilities', () => {
  it('normalizes each capability without creating a working directory', () => {
    expect(resolveHostToolCapabilities(['Read'])).toEqual({ read: true, write: false, web: false });
    expect(resolveHostToolCapabilities(['Write'])).toEqual({ read: true, write: true, web: false });
    expect(resolveHostToolCapabilities(['Web'])).toEqual({ read: false, write: false, web: true });
    expect(resolveHostToolCapabilities([everythingHostTools])).toEqual({ read: true, write: true, web: true });
    expect(fs.existsSync(base)).toBe(false);
  });
});

describe('seedHostWorkspaceGuide', () => {
  afterEach(removeTestDirectory);

  it('creates the provider-specific guide files', () => {
    const access = resolveHostToolAccess(['Read'], { workingDirectoryBase: base, workingDirId: 'game-player' });

    seedHostWorkspaceGuide(access, 'codex');
    seedHostWorkspaceGuide(access, 'claude-code');

    expect(fs.statSync(path.join(access.workingDirectory!, hostWorkspaceGuideFiles.codex)).isFile()).toBe(true);
    expect(fs.statSync(path.join(access.workingDirectory!, hostWorkspaceGuideFiles['claude-code'])).isFile()).toBe(true);
  });

  it('preserves edited and empty guides across repeated attempts', () => {
    const access = resolveHostToolAccess(['Write'], { workingDirectoryBase: base, workingDirId: 'game-player' });
    const codexPath = path.join(access.workingDirectory!, hostWorkspaceGuideFiles.codex);
    const claudePath = path.join(access.workingDirectory!, hostWorkspaceGuideFiles['claude-code']);
    fs.writeFileSync(codexPath, 'Agent-maintained instructions.');
    fs.writeFileSync(claudePath, '');

    seedHostWorkspaceGuide(access, 'codex');
    seedHostWorkspaceGuide(access, 'claude-code');
    seedHostWorkspaceGuide(access, 'codex');
    seedHostWorkspaceGuide(access, 'claude-code');

    expect(fs.readFileSync(codexPath, 'utf8')).toBe('Agent-maintained instructions.');
    expect(fs.readFileSync(claudePath, 'utf8')).toBe('');
  });

  it('recreates a removed guide because it does not cache prior attempts', () => {
    const access = resolveHostToolAccess(['Read'], { workingDirectoryBase: base, workingDirId: 'game-player' });
    const guidePath = path.join(access.workingDirectory!, hostWorkspaceGuideFiles.codex);

    seedHostWorkspaceGuide(access, 'codex');
    fs.rmSync(guidePath);
    seedHostWorkspaceGuide(access, 'codex');

    expect(fs.existsSync(guidePath)).toBe(true);
  });

  it('tolerates the existing-file result from a concurrent guide creation', () => {
    const access = resolveHostToolAccess(['Read'], { workingDirectoryBase: base, workingDirId: 'game-player' });
    const existingError = Object.assign(new Error('Guide already created.'), { code: 'EEXIST' });
    const writeFileSync = fs.writeFileSync.bind(fs);
    const writeGuide = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce((guidePath) => {
      writeFileSync(guidePath, 'Guide created by the concurrent caller.');
      throw existingError;
    });

    expect(() => seedHostWorkspaceGuide(access, 'codex')).not.toThrow();
    expect(writeGuide).toHaveBeenCalledWith(
      path.join(access.workingDirectory!, hostWorkspaceGuideFiles.codex),
      expect.any(String),
      { encoding: 'utf8', flag: 'wx' },
    );

    writeGuide.mockRestore();
  });

  it('leaves an agent-created directory at the guide path alone', () => {
    const access = resolveHostToolAccess(['Read'], { workingDirectoryBase: base, workingDirId: 'game-player' });
    const guidePath = path.join(access.workingDirectory!, hostWorkspaceGuideFiles.codex);
    fs.mkdirSync(guidePath);

    expect(() => seedHostWorkspaceGuide(access, 'codex')).not.toThrow();
    expect(fs.lstatSync(guidePath).isDirectory()).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('leaves an agent-created guide link and its target alone', () => {
    const access = resolveHostToolAccess(['Read'], { workingDirectoryBase: base, workingDirId: 'game-player' });
    const guidePath = path.join(access.workingDirectory!, hostWorkspaceGuideFiles.codex);
    fs.mkdirSync(outside, { recursive: true });
    const outsideGuide = path.join(outside, hostWorkspaceGuideFiles.codex);
    fs.writeFileSync(outsideGuide, 'Outside instructions.');
    fs.symlinkSync(outsideGuide, guidePath, 'file');

    expect(() => seedHostWorkspaceGuide(access, 'codex')).not.toThrow();
    expect(fs.lstatSync(guidePath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(outsideGuide, 'utf8')).toBe('Outside instructions.');
  });

  it('does not seed a guide without filesystem access', () => {
    const access = resolveHostToolAccess(['Web'], {
      workingDirectoryBase: base,
      workingDirId: 'web-only',
      workingDirectoryTools: ['Read', 'Write'],
    });

    seedHostWorkspaceGuide(access, 'codex');

    expect(fs.existsSync(base)).toBe(false);
  });

  it('skips the guide without failing the model call when the write is denied', () => {
    const access = resolveHostToolAccess(['Read'], { workingDirectoryBase: base, workingDirId: 'game-player' });
    const writeError = Object.assign(new Error('Permission denied.'), { code: 'EACCES' });
    const writeGuide = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => { throw writeError; });

    expect(() => seedHostWorkspaceGuide(access, 'codex')).not.toThrow();
    expect(fs.existsSync(path.join(access.workingDirectory!, hostWorkspaceGuideFiles.codex))).toBe(false);

    writeGuide.mockRestore();
  });
});
