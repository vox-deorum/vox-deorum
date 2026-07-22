/** Tests for the isolated lifecycle manager for codex-openai-proxy. */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  buildCodexProxyCommand,
  CodexProxyError,
  CodexProxyProbeTimeoutError,
  CodexProxyManager,
  getCodexProxyConfig,
  splitCodexProxyCommand,
} from '../../../../src/utils/models/providers/codex-proxy.js';

/** Creates an alive child process double with the manager's small required surface. */
function createChild(pid = 42): any {
  const child = new EventEmitter() as any;
  child.pid = pid;
  child.exitCode = null;
  child.killed = false;
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => true);
  return child;
}

/** Produces a JSON response with the status used by the audited proxy endpoints. */
function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Builds a manager without global process hooks, real networking, or real subprocesses. */
function createManager(fetch: typeof globalThis.fetch, spawn = vi.fn(() => createChild()), extra: Record<string, unknown> = {}): CodexProxyManager {
  return new CodexProxyManager({
    env: {},
    fetch,
    spawn: spawn as any,
    delay: async () => undefined,
    registerShutdown: () => undefined,
    registerExit: () => undefined,
    makeDirectory: async () => undefined,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    ...extra,
  });
}

describe('codex proxy command configuration', () => {
  it('should append exactly the rc.2 serve options without shell quoting', () => {
    const config = getCodexProxyConfig({
      CODEX_PROXY_COMMAND: '"C:\\Program Files\\node\\npx.cmd" --yes proxy',
      CODEX_PROXY_ROOT: 'C:\\Temp & Files\\vox',
      CODEX_PROXY_PORT: '9123',
      CODEX_PROXY_REQUEST_TIMEOUT: '31s',
      CODEX_PROXY_TOOL_TIMEOUT: '2m',
      CODEX_PROXY_STARTUP_TIMEOUT: '4m',
    });
    expect(splitCodexProxyCommand(config.command)).toEqual(['C:\\Program Files\\node\\npx.cmd', '--yes', 'proxy']);
    expect(buildCodexProxyCommand(config)).toEqual({
      command: 'C:\\Program Files\\node\\npx.cmd',
      args: [
        '--yes', 'proxy', 'serve', '--root', 'C:\\Temp & Files\\vox', '--port', '9123',
        '--request-timeout', '31000ms', '--tool-timeout', '120000ms', '--shutdown-timeout', '10000ms',
      ],
    });
  });
});

describe('CodexProxyManager startup', () => {
  it('should register shutdown hooks only when the manager is first used', async () => {
    const registerShutdown = vi.fn();
    const registerExit = vi.fn();
    const fetch = vi.fn((url: string) => Promise.resolve(
      response(200, url.endsWith('/health') ? { status: 'ok' } : { status: 'ready' }),
    ));
    const manager = createManager(fetch as any, vi.fn(), { registerShutdown, registerExit });

    expect(registerShutdown).not.toHaveBeenCalled();
    expect(registerExit).not.toHaveBeenCalled();
    await manager.ensureCodexProxy();
    expect(registerShutdown).toHaveBeenCalledTimes(1);
    expect(registerExit).toHaveBeenCalledTimes(1);
    await manager.ensureCodexProxy();
    expect(registerShutdown).toHaveBeenCalledTimes(1);
    expect(registerExit).toHaveBeenCalledTimes(1);
  });

  it('should share one owned startup across concurrent callers', async () => {
    const child = createChild();
    const spawn = vi.fn(() => child);
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValue(response(200, { status: 'ready' }));
    const manager = createManager(fetch, spawn);

    await Promise.all([manager.ensureCodexProxy(), manager.ensureCodexProxy()]);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(manager.state).toBe('ready-owned');
  });

  it('should adopt a compatible health shape without requiring the pinned proxy version', async () => {
    const spawn = vi.fn(() => createChild());
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { status: 'ok', proxy_version: '0.2.0' }))
      .mockResolvedValueOnce(response(200, { status: 'ready' }));
    const manager = createManager(fetch, spawn, { logger });

    await manager.ensureCodexProxy();

    expect(spawn).not.toHaveBeenCalled();
    expect(manager.state).toBe('ready-adopted');
    expect(logger.info).toHaveBeenCalledWith('Detected Codex proxy version 0.2.0.');
  });

  it('should resolve injected configuration once across readiness probes', async () => {
    let portReads = 0;
    const env: NodeJS.ProcessEnv = {};
    Object.defineProperty(env, 'CODEX_PROXY_PORT', {
      enumerable: true,
      get: () => {
        portReads += 1;
        return '8787';
      },
    });
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(response(503, { status: 'not_ready' }))
      .mockResolvedValueOnce(response(200, { status: 'ready' }));
    const manager = createManager(fetch, vi.fn(() => createChild()), { env });

    await manager.ensureCodexProxy();

    expect(portReads).toBe(1);
    expect(fetch.mock.calls.every(([url]) => String(url).startsWith('http://127.0.0.1:8787/'))).toBe(true);
  });

  it('should reacquire ownership when an adopted proxy disappears', async () => {
    const spawn = vi.fn(() => createChild());
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { status: 'ok' }))
      .mockResolvedValueOnce(response(200, { status: 'ready' }))
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(response(200, { status: 'ready' }));
    const manager = createManager(fetch, spawn);

    await manager.ensureCodexProxy();
    await manager.ensureCodexProxy();

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(manager.state).toBe('ready-owned');
  });

  it('should replace an adopted proxy that times out during a reprobe', async () => {
    let probeCount = 0;
    const probeTimeout = vi.fn(async (operation: Promise<unknown>) => {
      probeCount += 1;
      if (probeCount === 3) throw new CodexProxyProbeTimeoutError();
      return operation;
    });
    const spawn = vi.fn(() => createChild());
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { status: 'ok' }))
      .mockResolvedValueOnce(response(200, { status: 'ready' }))
      .mockResolvedValueOnce(response(200, { status: 'ok' }))
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(response(200, { status: 'ready' }));
    const manager = createManager(fetch, spawn, { probeTimeout: probeTimeout as any });

    await manager.ensureCodexProxy();
    await manager.ensureCodexProxy();

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(manager.state).toBe('ready-owned');
  });

  it('should install an owned state when an adopted proxy disappears during startup', async () => {
    const spawn = vi.fn(() => createChild());
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { status: 'ok' }))
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(response(200, { status: 'ready' }));
    const manager = createManager(fetch, spawn);

    await manager.ensureCodexProxy();
    await manager.ensureCodexProxy();

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(manager.state).toBe('ready-owned');
  });

  it('should share one restart across concurrent failed adopted reprobes', async () => {
    let releaseSlowHealth: ((value: Response) => void) | undefined;
    const slowHealth = new Promise<Response>((resolve) => { releaseSlowHealth = resolve; });
    let releaseOwnedReady: ((value: Response) => void) | undefined;
    const ownedReady = new Promise<Response>((resolve) => { releaseOwnedReady = resolve; });
    let markOwnedProbeStarted: (() => void) | undefined;
    const ownedProbeStarted = new Promise<void>((resolve) => { markOwnedProbeStarted = resolve; });
    let markSlowReadyStarted: (() => void) | undefined;
    const slowReadyStarted = new Promise<void>((resolve) => { markSlowReadyStarted = resolve; });
    let fetchCount = 0;
    const fetch = vi.fn(() => {
      fetchCount += 1;
      if (fetchCount === 1) return Promise.resolve(response(200, { status: 'ok' }));
      if (fetchCount === 2) return Promise.resolve(response(200, { status: 'ready' }));
      if (fetchCount === 3) return slowHealth;
      if (fetchCount >= 4 && fetchCount <= 6) return Promise.reject(new TypeError('connection refused'));
      if (fetchCount === 7) {
        markOwnedProbeStarted?.();
        return ownedReady;
      }
      markSlowReadyStarted?.();
      return Promise.resolve(response(200, { status: 'ready' }));
    });
    const spawn = vi.fn(() => createChild());
    const manager = createManager(fetch as any, spawn);

    await manager.ensureCodexProxy();
    const slowReprobe = manager.ensureCodexProxy();
    const fastReprobe = manager.ensureCodexProxy();
    await ownedProbeStarted;
    releaseSlowHealth?.(response(503, { status: 'not_ready' }));
    await slowReadyStarted;
    releaseOwnedReady?.(response(200, { status: 'ready' }));
    await Promise.all([slowReprobe, fastReprobe]);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(manager.state).toBe('ready-owned');
  });

  it('should reject an incompatible occupied port without retrying', async () => {
    const manager = createManager(vi.fn().mockResolvedValue(response(200, { status: 'different-service' })));

    await expect(manager.ensureCodexProxy()).rejects.toMatchObject<CodexProxyError>({ retryable: false });
    expect(manager.state).toBe('stopped');
  });

  it('should classify a synchronous missing command as terminal and leave no stale startup state', async () => {
    const missing = Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' });
    const manager = createManager(
      vi.fn().mockRejectedValue(new TypeError('connection refused')),
      vi.fn(() => { throw missing; }),
    );

    await expect(manager.ensureCodexProxy()).rejects.toMatchObject<CodexProxyError>({ isRetryable: false });
    expect(manager.state).toBe('stopped');
  });

  it('should terminate an owned proxy that times out before readiness', async () => {
    const child = createChild(88);
    const terminate = vi.fn(async () => { child.exitCode = 1; });
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(2);
    const manager = createManager(
      vi.fn()
        .mockRejectedValueOnce(new TypeError('connection refused'))
        .mockResolvedValue(response(503, { status: 'not_ready' })),
      vi.fn(() => child),
      {
        env: { CODEX_PROXY_STARTUP_TIMEOUT: '1ms' },
        now,
        terminateTree: terminate,
      },
    );

    await expect(manager.ensureCodexProxy()).rejects.toMatchObject<CodexProxyError>({ isRetryable: true });
    expect(terminate).toHaveBeenCalledWith(88, false, process.platform);
    expect(manager.state).toBe('stopped');
  });

  it('should restart after an intentional child exit during owned invalidation', async () => {
    const first = createChild(91);
    const second = createChild(92);
    const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const terminate = vi.fn(async () => {
      first.exitCode = 0;
      first.emit('exit', 0);
    });
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(response(200, { status: 'ready' }))
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(response(200, { status: 'ready' }));
    const manager = createManager(fetch, spawn, { terminateTree: terminate });

    await manager.ensureCodexProxy();
    (manager as any).childFailure = new CodexProxyError('stale failure', true);
    manager.invalidateConnection();
    expect((manager as any).childFailure).toBeUndefined();
    await manager.ensureCodexProxy();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(manager.state).toBe('ready-owned');
  });

  it('should recover from a retryable owned proxy crash', async () => {
    const first = createChild(93);
    const second = createChild(94);
    const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(response(200, { status: 'ready' }))
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(response(200, { status: 'ready' }));
    const manager = createManager(fetch, spawn);

    await manager.ensureCodexProxy();
    first.exitCode = 1;
    first.emit('exit', 1);
    await manager.ensureCodexProxy();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(manager.state).toBe('ready-owned');
  });

  it('should use Node and npm\'s npx CLI for the default Windows command', async () => {
    const spawn = vi.fn(() => createChild());
    const manager = createManager(
      vi.fn()
        .mockRejectedValueOnce(new TypeError('connection refused'))
        .mockResolvedValue(response(200, { status: 'ready' })),
      spawn,
      { platform: 'win32', execPath: 'C:\\Program Files\\nodejs\\node.exe', fileExists: () => true },
    );

    await manager.ensureCodexProxy();

    const [command, args] = spawn.mock.calls[0];
    expect(command).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(args.slice(0, 4)).toEqual([
      'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js',
      '--yes', `codex-openai-proxy@0.1.0-rc.2`, 'serve',
    ]);
  });

  it('should reject a missing Windows npm CLI before spawning', async () => {
    const spawn = vi.fn(() => createChild());
    const manager = createManager(
      vi.fn().mockRejectedValue(new TypeError('connection refused')),
      spawn,
      { platform: 'win32', execPath: 'C:\\node\\node.exe', fileExists: () => false },
    );

    await expect(manager.ensureCodexProxy()).rejects.toMatchObject<CodexProxyError>({ isRetryable: false });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('should reject a silent startup health probe as an occupied port', async () => {
    const manager = createManager(
      vi.fn(() => new Promise<Response>(() => undefined)) as any,
      vi.fn(),
      { probeTimeout: async () => { throw new CodexProxyProbeTimeoutError(); } },
    );

    await expect(manager.ensureCodexProxy()).rejects.toMatchObject<CodexProxyError>({
      isRetryable: false,
      message: expect.stringContaining('Port 8787 is occupied'),
    });
    expect(manager.state).toBe('stopped');
  });

  it('should redact buffered plain stderr secrets while preserving the device-login instruction', async () => {
    const child = createChild();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const manager = createManager(
      vi.fn()
        .mockRejectedValueOnce(new TypeError('connection refused'))
        .mockResolvedValue(response(200, { status: 'ready' })),
      vi.fn(() => child),
      { logger },
    );

    await manager.ensureCodexProxy();
    child.stderr.emit('data', 'Open https://login.example/?device_code=DEVI');
    child.stderr.emit('data', 'CESECRET with Bearer abc.def.ghi\n');
    const output = logger.info.mock.calls.flat().join(' ');

    expect(output).toContain('Open https://login.example/');
    expect(output).toContain('device_code=[redacted]');
    expect(output).toContain('Bearer [redacted]');
    expect(output).not.toContain('DEVICESECRET');
    expect(output).not.toContain('abc.def.ghi');
  });

  it('should redact credentials embedded in structured proxy log strings', async () => {
    const child = createChild();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const manager = createManager(
      vi.fn()
        .mockRejectedValueOnce(new TypeError('connection refused'))
        .mockResolvedValue(response(200, { status: 'ready' })),
      vi.fn(() => child),
      { logger },
    );

    await manager.ensureCodexProxy();
    child.stderr.emit('data', `${JSON.stringify({
      level: 'info',
      message: 'Bearer abc.def.ghi',
      instruction: 'device code: DEVICESECRET',
      loginUrl: 'https://login.example/?device_code=DEVICESECRET',
      authorization: 'secret-value',
    })}\n`);
    const output = JSON.stringify(logger.info.mock.calls);

    expect(output).toContain('Bearer [redacted]');
    expect(output).toContain('device code: [redacted]');
    expect(output).toContain('https://login.example/?device_code=[redacted]');
    expect(output).not.toContain('abc.def.ghi');
    expect(output).not.toContain('DEVICESECRET');
    expect(output).not.toContain('secret-value');
  });

  it('should treat proxy-root creation failure as terminal', async () => {
    const manager = createManager(
      vi.fn().mockRejectedValue(new TypeError('connection refused')),
      vi.fn(),
      { makeDirectory: async () => { throw new Error('access denied'); } },
    );

    await expect(manager.ensureCodexProxy()).rejects.toMatchObject<CodexProxyError>({ isRetryable: false });
    expect(manager.state).toBe('stopped');
  });

  it('should let an aborted caller leave shared startup running for another caller', async () => {
    let resolveReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(response(503, { status: 'not_ready' }))
      .mockResolvedValue(response(200, { status: 'ready' }));
    const manager = createManager(fetch, vi.fn(() => createChild()), { delay: () => ready });
    const controller = new AbortController();
    const aborted = manager.ensureCodexProxy(controller.signal);
    const shared = manager.ensureCodexProxy();

    controller.abort(new Error('caller cancelled'));
    await expect(aborted).rejects.toThrow('caller cancelled');
    resolveReady?.();
    await shared;
    expect(manager.state).toBe('ready-owned');
  });
});

describe('CodexProxyManager shutdown', () => {
  it('should not spawn after shutdown while root creation is pending', async () => {
    let releaseDirectory: (() => void) | undefined;
    const directoryReady = new Promise<void>((resolve) => { releaseDirectory = resolve; });
    let enteredDirectory: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { enteredDirectory = resolve; });
    const spawn = vi.fn(() => createChild());
    const manager = createManager(
      vi.fn().mockRejectedValue(new TypeError('connection refused')),
      spawn,
      { makeDirectory: async () => { enteredDirectory?.(); await directoryReady; } },
    );

    const startup = manager.ensureCodexProxy();
    await entered;
    await manager.shutdown();
    releaseDirectory?.();

    await expect(startup).rejects.toMatchObject<CodexProxyError>({ isRetryable: true });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('should terminate a detached invalidation child during shutdown without restarting it', async () => {
    const child = createChild(96);
    const spawn = vi.fn(() => child);
    let terminationCalls = 0;
    let releaseFirstTermination: (() => void) | undefined;
    const firstTermination = new Promise<void>((resolve) => { releaseFirstTermination = resolve; });
    const terminate = vi.fn(async () => {
      terminationCalls += 1;
      if (terminationCalls === 1) await firstTermination;
      child.exitCode = 0;
      child.emit('exit', 0);
      releaseFirstTermination?.();
    });
    const manager = createManager(
      vi.fn()
        .mockRejectedValueOnce(new TypeError('connection refused'))
        .mockResolvedValue(response(200, { status: 'ready' })),
      spawn,
      { terminateTree: terminate },
    );

    await manager.ensureCodexProxy();
    manager.invalidateConnection();
    await manager.shutdown();
    await Promise.resolve();

    expect(terminate).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(manager.state).toBe('stopped');
  });

  it('should preserve an adopted proxy while stopping an owned process tree', async () => {
    const adoptedTerminate = vi.fn();
    const adopted = createManager(vi.fn()
      .mockResolvedValueOnce(response(200, { status: 'ok' }))
      .mockResolvedValueOnce(response(200, { status: 'ready' })), vi.fn(), { terminateTree: adoptedTerminate });
    await adopted.ensureCodexProxy();
    await adopted.shutdown();
    expect(adoptedTerminate).not.toHaveBeenCalled();

    const ownedChild = createChild(77);
    const terminate = vi.fn(async () => { ownedChild.exitCode = 0; });
    const owned = createManager(vi.fn()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(response(200, { status: 'ready' })), vi.fn(() => ownedChild), { terminateTree: terminate });
    await owned.ensureCodexProxy();
    await owned.shutdown();
    expect(terminate).toHaveBeenCalledWith(77, false, process.platform);
  });
});
