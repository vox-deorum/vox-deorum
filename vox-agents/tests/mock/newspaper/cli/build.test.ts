import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { buildNewspaperDependencies } from '../../../../src/newspaper/cli/build.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));

describe('newspaper dependency builds', () => {
  const originalExitCode = process.exitCode;
  let children: EventEmitter[];

  beforeEach(() => {
    vi.stubEnv('npm_execpath', '/npm installation/npm-cli.js');
    children = [];
    vi.mocked(spawn).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { pid: 12345, kill: vi.fn() });
      children.push(child);
      return child as unknown as ReturnType<typeof spawn>;
    });
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('should build only MCP for a run without previews', async () => {
    const result = buildNewspaperDependencies(false, new AbortController().signal);
    expect(spawn).toHaveBeenCalledWith(process.execPath,
      ['/npm installation/npm-cli.js', 'run', 'build', '--workspace', 'mcp-server'],
      expect.objectContaining({ cwd: fileURLToPath(new URL('../../../../../', import.meta.url)), stdio: 'inherit' }));
    children[0].emit('close', 0, null);
    await result;
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('should wait for MCP before building preview assets', async () => {
    const result = buildNewspaperDependencies(true, new AbortController().signal);
    expect(spawn).toHaveBeenCalledTimes(1);
    children[0].emit('close', 0, null);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    expect(vi.mocked(spawn).mock.calls[1][1]).toEqual([
      '/npm installation/npm-cli.js', 'run', 'build:newspaper', '--workspace', 'vox-agents',
    ]);
    children[1].emit('close', 0, null);
    await result;
  });

  it('should stop after a failed build and preserve its exit code', async () => {
    const result = buildNewspaperDependencies(true, new AbortController().signal);
    const rejection = expect(result).rejects.toThrow(/mcp-server/);
    children[0].emit('close', 7, null);
    await rejection;
    expect(process.exitCode).toBe(7);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('should terminate the build process tree on cancellation', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const controller = new AbortController();
    const result = buildNewspaperDependencies(true, controller.signal);
    const reason = new Error('cancelled');
    const rejection = expect(result).rejects.toBe(reason);
    controller.abort(reason);
    if (process.platform === 'win32') {
      expect(spawnSync).toHaveBeenCalledWith('taskkill', ['/pid', '12345', '/t', '/f'], expect.any(Object));
    } else {
      expect(kill).toHaveBeenCalledWith(-12345, 'SIGTERM');
    }
    children[0].emit('close', null, 'SIGTERM');
    await rejection;
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
