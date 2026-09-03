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
import { executionTimeoutDefault } from '../../../../src/utils/retry.js';

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
    openLoginUrl: async () => undefined,
    ...extra,
  });
}

describe('codex proxy command configuration', () => {
  it('should use the shared model execution timeout as its request deadline', () => {
    expect(getCodexProxyConfig({}).requestTimeoutMs).toBe(executionTimeoutDefault);
  });

  it('should append exactly the serve options without shell quoting', () => {
    const config = getCodexProxyConfig({
      CODEX_PROXY_COMMAND: '"C:\\Program Files\\node\\npx.cmd" --yes proxy',
      CODEX_PROXY_ROOT: 'C:\\Temp & Files\\vox',
      CODEX_PROXY_PORT: '9123',
      CODEX_PROXY_REQUEST_TIMEOUT: '31s',
      CODEX_PROXY_STARTUP_TIMEOUT: '4m',
    });
    expect(splitCodexProxyCommand(config.command)).toEqual(['C:\\Program Files\\node\\npx.cmd', '--yes', 'proxy']);
    expect(buildCodexProxyCommand(config)).toEqual({
      command: 'C:\\Program Files\\node\\npx.cmd',
      args: [
        '--yes', 'proxy', 'serve', '--root', 'C:\\Temp & Files\\vox', '--port', '9123',
        '--log-level', 'info',
        '--login', 'device-code',
        '--request-timeout', '31000ms', '--shutdown-timeout', '10000ms',
      ],
    });
  });

  it('should raise the proxy log level only when Winston would keep debug records', () => {
    expect(getCodexProxyConfig({}).logLevel).toBe('info');
    expect(getCodexProxyConfig({ LOG_LEVEL: 'verbose' }).logLevel).toBe('info');
    expect(getCodexProxyConfig({ LOG_LEVEL: 'debug' }).logLevel).toBe('debug');
    expect(getCodexProxyConfig({ LOG_LEVEL: 'silly' }).logLevel).toBe('debug');
    expect(buildCodexProxyCommand(getCodexProxyConfig({ LOG_LEVEL: 'debug' })).args).toEqual(
      expect.arrayContaining(['--log-level', 'debug']),
    );
  });
});

describe('CodexProxyManager startup', () => {
  it('should register shutdown hooks only when the manager is first used', async () => {
    const registerShutdown = vi.fn();
    const registerExit = vi.fn();
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValue(response(200, { status: 'ready' }));
    const manager = createManager(fetch as any, vi.fn(() => createChild()), { registerShutdown, registerExit });

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
    expect(manager.state).toBe('ready');
  });

  it('should move past a responsive pre-existing listener onto the next free port', async () => {
    const spawn = vi.fn(() => createChild());
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { status: 'ok', proxy_version: '0.2.0' }))
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValue(response(200, { status: 'ready' }));
    const manager = createManager(fetch, spawn, { logger });

    await manager.ensureCodexProxy();

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--port', '8788']));
    expect(manager.activePort).toBe(8788);
    expect(manager.state).toBe('ready');
    expect(String(fetch.mock.calls[0][0])).toBe('http://127.0.0.1:8787/health');
    expect(fetch.mock.calls.slice(1).every(([url]) => String(url).startsWith('http://127.0.0.1:8788/'))).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith('Port 8787 is occupied by an existing listener. Trying port 8788.');
  });

  it('should never adopt an existing listener it did not start', async () => {
    const spawn = vi.fn(() => createChild());
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { status: 'ready', proxy_version: '0.1.0-rc.15' }))
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValue(response(200, { status: 'ready' }));
    const manager = createManager(fetch, spawn);

    await manager.ensureCodexProxy();

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(manager.activePort).toBe(8788);
  });

  it('should report the configured port as active before any startup', () => {
    expect(createManager(vi.fn()).activePort).toBe(8787);
  });

  it('should re-scan from the configured port when a later generation restarts', async () => {
    const first = createChild(81);
    const second = createChild(82);
    const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, { status: 'other-service' }))
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValueOnce(response(200, { status: 'ready' }))
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockResolvedValue(response(200, { status: 'ready' }));
    const manager = createManager(fetch, spawn);

    await manager.ensureCodexProxy();
    expect(manager.activePort).toBe(8788);
    first.exitCode = 1;
    first.emit('exit', 1);
    await manager.ensureCodexProxy();

    expect(spawn.mock.calls[1][1]).toEqual(expect.arrayContaining(['--port', '8787']));
    expect(manager.activePort).toBe(8787);
    expect(manager.state).toBe('ready');
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

  it('should reject an exhausted port scan without retrying', async () => {
    const fetch = vi.fn(async () => response(200, { status: 'different-service' }));
    const spawn = vi.fn(() => createChild());
    const manager = createManager(fetch, spawn);

    await expect(manager.ensureCodexProxy()).rejects.toMatchObject<CodexProxyError>({
      retryable: false,
      message: 'Ports 8787 through 8796 are all occupied by existing listeners. Stop a listener or change CODEX_PROXY_PORT.',
    });
    expect(fetch).toHaveBeenCalledTimes(10);
    expect(spawn).not.toHaveBeenCalled();
    expect(manager.state).toBe('stopped');
  });

  it('should scan a single candidate when the configured port ends the range', async () => {
    const manager = createManager(
      vi.fn(async () => response(200, { status: 'different-service' })),
      vi.fn(() => createChild()),
      { env: { CODEX_PROXY_PORT: '65535' } },
    );

    await expect(manager.ensureCodexProxy()).rejects.toMatchObject<CodexProxyError>({
      retryable: false,
      message: 'Port 65535 is occupied by an existing listener. Stop a listener or change CODEX_PROXY_PORT.',
    });
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
    expect(manager.state).toBe('ready');
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
    expect(manager.state).toBe('ready');
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
      '--yes', `codex-openai-proxy@0.1.0-rc.22`, 'serve',
    ]);
  });

  it('should retain a custom command and log it without claiming the pinned proxy', async () => {
    const child = createChild();
    const spawn = vi.fn(() => child);
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const manager = createManager(
      vi.fn()
        .mockRejectedValueOnce(new TypeError('connection refused'))
        .mockResolvedValue(response(200, { status: 'ready' })),
      spawn,
      { env: { CODEX_PROXY_COMMAND: 'custom-proxy --diagnostic' }, logger },
    );

    await manager.ensureCodexProxy();

    expect(spawn).toHaveBeenCalledWith('custom-proxy', expect.arrayContaining([
      '--diagnostic', 'serve', '--root', expect.any(String), '--port', '8787',
    ]), expect.any(Object));
    expect(logger.info).toHaveBeenCalledWith('Starting the configured CODEX_PROXY_COMMAND on port 8787.');
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('codex-openai-proxy@'));
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

  it('should reject a scan of silent startup health probes as occupied ports', async () => {
    const spawn = vi.fn();
    const manager = createManager(
      vi.fn(() => new Promise<Response>(() => undefined)) as any,
      spawn,
      { probeTimeout: async () => { throw new CodexProxyProbeTimeoutError(); } },
    );

    await expect(manager.ensureCodexProxy()).rejects.toMatchObject<CodexProxyError>({
      isRetryable: false,
      message: expect.stringContaining('Ports 8787 through 8796 are all occupied'),
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(manager.state).toBe('stopped');
  });

  it('should skip a silent listener and start on the next free port', async () => {
    const spawn = vi.fn(() => createChild());
    const probeTimeout = vi.fn(async (operation: Promise<unknown>) => operation)
      .mockImplementationOnce(async () => { throw new CodexProxyProbeTimeoutError(); });
    const manager = createManager(
      vi.fn()
        .mockReturnValueOnce(new Promise<Response>(() => undefined))
        .mockRejectedValueOnce(new TypeError('connection refused'))
        .mockResolvedValue(response(200, { status: 'ready' })) as any,
      spawn,
      { probeTimeout },
    );

    await manager.ensureCodexProxy();

    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--port', '8788']));
    expect(manager.state).toBe('ready');
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
    child.stderr.emit('data', 'Open https://auth.openai.com/codex/device and enter code ABCD-1234.\n');
    const output = logger.info.mock.calls.flat().join(' ');

    expect(output).toContain('Open https://login.example/');
    expect(output).toContain('device_code=[redacted]');
    expect(output).toContain('Bearer [redacted]');
    expect(output).toContain('enter code ABCD-1234');
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

  it('should not forward empty proxy logs', async () => {
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
    child.stderr.emit('data', '\u001B[0m\n');
    child.stderr.emit('data', '{}\n');
    child.stderr.emit('data', 'Proxy notice\n');
    child.stderr.emit('data', `${JSON.stringify({ event: 'server_listening' })}\n`);

    const forwarded = logger.info.mock.calls.filter((call) => call[0] === 'Codex proxy:');
    expect(forwarded).toEqual([['Codex proxy:', { event: 'server_listening' }]]);
    expect(logger.info).toHaveBeenCalledWith('Codex proxy: Proxy notice');
  });

  it('should demote readiness and health request records to debug regardless of their own level', async () => {
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
    const record = (path: string) => `${JSON.stringify({ level: 'info', event: 'http_request', method: 'GET', path, status: 503 })}\n`;
    child.stderr.emit('data', record('/ready'));
    child.stderr.emit('data', record('/health'));
    child.stderr.emit('data', record('/v1/chat/completions'));

    const debugPaths = logger.debug.mock.calls.map((call) => call[1]?.path);
    expect(debugPaths).toEqual(['/ready', '/health']);
    const infoPaths = logger.info.mock.calls.filter((call) => call[0] === 'Codex proxy:').map((call) => call[1]?.path);
    expect(infoPaths).toEqual(['/v1/chat/completions']);
  });

  it('should open and announce each new device-login prompt while keeping the structured record redacted', async () => {
    const child = createChild();
    const openLoginUrl = vi.fn(async () => undefined);
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const manager = createManager(
      vi.fn()
        .mockRejectedValueOnce(new TypeError('connection refused'))
        .mockResolvedValue(response(200, { status: 'ready' })),
      vi.fn(() => child),
      { logger, openLoginUrl },
    );

    await manager.ensureCodexProxy();
    const prompt = `${JSON.stringify({
      level: 'info',
      event: 'device_code_login_started',
      verification_url: 'https://auth.openai.com/codex/device',
      user_code: 'ABCD-1234',
    })}\n`;
    child.stderr.emit('data', prompt);
    child.stderr.emit('data', prompt);
    expect(manager.loginPrompt).toEqual({
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
    });
    child.exitCode = 1;
    child.emit('exit', 1);
    expect(manager.loginPrompt).toBeUndefined();
    child.stderr.emit('data', prompt.replace('ABCD-1234', 'WXYZ-5678'));

    expect(openLoginUrl).toHaveBeenCalledOnce();
    expect(openLoginUrl).toHaveBeenCalledWith('https://auth.openai.com/codex/device', process.platform);
    const announcements = logger.info.mock.calls.filter((call) => typeof call[0] === 'string' && call[0].includes('Codex sign-in required'));
    expect(announcements).toHaveLength(1);
    expect(announcements[0][0]).toContain('https://auth.openai.com/codex/device');
    expect(announcements[0][0]).toContain('ABCD-1234');
    const forwarded = logger.info.mock.calls.filter((call) => call[0] === 'Codex proxy:');
    expect(JSON.stringify(forwarded)).toContain('[redacted]');
    expect(JSON.stringify(forwarded)).not.toContain('ABCD-1234');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('WXYZ-5678');
  });

  it('should clear the login prompt when readiness completes', async () => {
    const child = createChild();
    const prompt = `${JSON.stringify({
      event: 'device_code_login_started',
      verification_url: 'https://auth.openai.com/codex/device',
      user_code: 'ABCD-1234',
    })}\n`;
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection refused'))
      .mockImplementationOnce(async () => {
        child.stderr.emit('data', prompt);
        return response(200, { status: 'ready' });
      });
    const manager = createManager(fetch, vi.fn(() => child));

    await manager.ensureCodexProxy();

    expect(manager.state).toBe('ready');
    expect(manager.loginPrompt).toBeUndefined();
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
    expect(manager.state).toBe('ready');
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

  it('should stop an owned process tree during shutdown', async () => {
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
