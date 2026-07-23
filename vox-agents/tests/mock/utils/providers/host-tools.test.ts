/** Tests for the shared host meta-tool policy. */

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { everythingHostTools, resolveHostToolAccess } from '../../../../src/utils/models/providers/host-tools.js';

const base = path.join(os.tmpdir(), 'vox-host-tools-test');

/** Removes temporary directories created by host-tool access tests. */
function removeTestDirectory(): void {
  fs.rmSync(base, { recursive: true, force: true });
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

  it('fails fast on names outside the meta-tool vocabulary', () => {
    for (const requested of [['Bash'], ['Glob'], ['Read', 'Bash'], [everythingHostTools, 'Read']]) {
      expect(() => resolveHostToolAccess(requested, { workingDirectoryBase: base }))
        .toThrow('Unsupported hostTools entries');
    }
    expect(fs.existsSync(base)).toBe(false);
  });
});
