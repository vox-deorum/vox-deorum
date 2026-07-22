/** Tests for the shared host-tool policy. */

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { everythingHostTools, resolveHostToolPolicy } from '../../../../src/utils/models/providers/host-tools.js';

const namespace = 'vox-host-tools-test';

/** Removes temporary directories created by host-tool policy tests. */
function removeTestDirectory(): void {
  fs.rmSync(path.join(os.tmpdir(), namespace), { recursive: true, force: true });
}

describe('resolveHostToolPolicy', () => {
  afterEach(removeTestDirectory);

  it('denies missing host tools without creating a directory', () => {
    expect(resolveHostToolPolicy(undefined, {
      blockedTools: ['Bash'],
      workingDirectoryNamespace: namespace,
      workingDirId: 'empty',
    })).toEqual({ allowedTools: [] });
    expect(fs.existsSync(path.join(os.tmpdir(), namespace))).toBe(false);
  });

  it('expands everything, blocks shell tools, and creates a scoped directory', () => {
    const policy = resolveHostToolPolicy([everythingHostTools], {
      everythingExpansion: ['Read', 'Bash'],
      blockedTools: ['Bash'],
      workingDirectoryNamespace: namespace,
      workingDirId: 'game-player',
    });
    expect(policy.allowedTools).toEqual(['Read']);
    expect(policy.workingDirectory).toBe(path.join(os.tmpdir(), namespace, 'game-player'));
    expect(fs.existsSync(policy.workingDirectory!)).toBe(true);
  });

  it('keeps an ordinary allowlist after filtering blocked tools', () => {
    const policy = resolveHostToolPolicy(['Read', 'Bash', 'Edit'], {
      blockedTools: ['Bash'],
      workingDirectoryNamespace: namespace,
      workingDirId: 'explicit',
    });
    expect(policy.allowedTools).toEqual(['Read', 'Edit']);
    expect(policy.workingDirectory).toBe(path.join(os.tmpdir(), namespace, 'explicit'));
    expect(fs.existsSync(policy.workingDirectory!)).toBe(true);
  });

  it('keeps everything disabled when a provider has no vetted expansion', () => {
    expect(resolveHostToolPolicy([everythingHostTools], {
      blockedTools: ['Bash'],
      workingDirectoryNamespace: namespace,
    })).toEqual({ allowedTools: [] });
    expect(fs.existsSync(path.join(os.tmpdir(), namespace))).toBe(false);
  });
});
