/**
 * @module utils/models/providers/codex-proxy
 *
 * Owns the lazy local lifecycle for the pinned Codex OpenAI-compatible proxy.
 * The proxy is deliberately the protocol boundary: this module only manages its
 * loopback process and never interprets Codex completion data.
 */

import { execFile, execFileSync, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { SpawnOptions } from 'node:child_process';
import { createLogger } from '../../logger.js';
import { processManager } from '../../../infra/process-manager.js';

/** The published proxy contract accepted by this integration. */
export const codexProxyVersion = '0.1.0-rc.2';

/** The proxy request deadline, kept below Vox's outer Codex attempt deadline. */
export const codexProxyRequestTimeoutDefault = 30_000;

/** The login and suspended-tool deadline accepted by the proxy CLI. */
export const codexProxyToolTimeoutDefault = 300_000;

/** The bounded time spent waiting for an authenticated proxy to become ready. */
export const codexProxyStartupTimeoutDefault = 300_000;

/** The grace period afforded to a proxy before its owned process tree is forced down. */
export const codexProxyShutdownGracePeriod = 15_000;

/** Extra time for the proxy to complete cancellation before Vox Deorum retries. */
export const codexExecutionTimeoutMargin = 30_000;

/** The proxy's own graceful HTTP shutdown deadline passed to its rc.2 CLI. */
export const codexProxyShutdownTimeoutDefault = 10_000;

/** The stable root used when a caller does not configure a narrower proxy root. */
export const codexProxyRootDefault = join(tmpdir(), 'vox-deorum-codex-proxy');

/** The exact default command is rewritten to Node's npm CLI only on Windows. */
export const codexProxyCommandDefault = `npx --yes codex-openai-proxy@${codexProxyVersion}`;

/** A probe cannot consume the entire startup budget while a loopback socket stays silent. */
export const codexProxyProbeTimeoutDefault = 5_000;

/** The explicit lifecycle states exposed for focused tests and diagnostics. */
export type CodexProxyState = 'stopped' | 'starting' | 'ready-owned' | 'ready-adopted';

/** A child surface that keeps the manager independent from Node's concrete ChildProcess. */
export interface CodexProxyChild {
  pid?: number;
  exitCode?: number | null;
  killed?: boolean;
  stderr?: NodeJS.ReadableStream | null;
  on(event: 'exit' | 'error', listener: (...args: any[]) => void): this;
  kill(signal?: NodeJS.Signals | number): boolean;
}

/** The validated options used to construct a proxy invocation. */
export interface CodexProxyConfig {
  port: number;
  command: string;
  root: string;
  requestTimeoutMs: number;
  toolTimeoutMs: number;
  startupTimeoutMs: number;
  shutdownTimeoutMs: number;
  shutdownGracePeriodMs: number;
}

/** Injectable side effects make startup, polling, and process shutdown deterministic in tests. */
export interface CodexProxyDependencies {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  fetch?: typeof globalThis.fetch;
  spawn?: (command: string, args: string[], options: SpawnOptions) => CodexProxyChild;
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  logger?: Pick<ReturnType<typeof createLogger>, 'debug' | 'info' | 'warn' | 'error'>;
  registerShutdown?: (name: string, hook: () => Promise<void>) => void;
  registerExit?: (handler: () => void) => void;
  terminateTree?: (pid: number, force: boolean, platform: NodeJS.Platform) => Promise<void>;
  terminateTreeSync?: (pid: number, platform: NodeJS.Platform) => void;
  makeDirectory?: (path: string) => Promise<void>;
  execPath?: string;
  fileExists?: (path: string) => boolean;
  probeTimeout?: <T>(operation: Promise<T>, timeoutMs: number, signal?: AbortSignal) => Promise<T>;
}

/** A classified proxy failure lets the existing outer retry layer distinguish terminal setup errors. */
export class CodexProxyError extends Error {
  public readonly retryable: boolean;
  public readonly isRetryable: boolean;

  /** Constructs a visible, retry-classified proxy failure. */
  constructor(message: string, retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CodexProxyError';
    this.retryable = retryable;
    this.isRetryable = retryable;
  }
}

/** Identifies a bounded loopback probe that connected but did not answer in time. */
export class CodexProxyProbeTimeoutError extends Error {
  /** Creates a timeout marker that callers can classify by probe phase. */
  constructor() {
    super('Codex proxy loopback probe timed out.');
    this.name = 'CodexProxyProbeTimeoutError';
  }
}

/** Returns the loopback origin without accidentally applying the API version prefix to probes. */
export function getCodexProxyOrigin(port = getCodexProxyConfig().port): string {
  return `http://127.0.0.1:${port}`;
}

/** Returns the OpenAI-compatible API base used by the provider adapter. */
export function getCodexProxyApiBase(port = getCodexProxyConfig().port): string {
  return `${getCodexProxyOrigin(port)}/v1`;
}

/** Reads and strictly validates the operator-facing proxy configuration. */
export function getCodexProxyConfig(env: NodeJS.ProcessEnv = process.env): CodexProxyConfig {
  const port = parseInteger('CODEX_PROXY_PORT', optionalEnvironmentValue(env.CODEX_PROXY_PORT) ?? '8787', 1, 65_535);
  const root = optionalEnvironmentValue(env.CODEX_PROXY_ROOT) ?? codexProxyRootDefault;
  if (!isAbsolute(root)) throw new CodexProxyError('CODEX_PROXY_ROOT must be an absolute path.', false);
  return {
    port,
    command: optionalEnvironmentValue(env.CODEX_PROXY_COMMAND) ?? codexProxyCommandDefault,
    root,
    requestTimeoutMs: parseDuration('CODEX_PROXY_REQUEST_TIMEOUT', optionalEnvironmentValue(env.CODEX_PROXY_REQUEST_TIMEOUT), codexProxyRequestTimeoutDefault),
    toolTimeoutMs: parseDuration('CODEX_PROXY_TOOL_TIMEOUT', optionalEnvironmentValue(env.CODEX_PROXY_TOOL_TIMEOUT), codexProxyToolTimeoutDefault),
    startupTimeoutMs: parseDuration('CODEX_PROXY_STARTUP_TIMEOUT', optionalEnvironmentValue(env.CODEX_PROXY_STARTUP_TIMEOUT), codexProxyStartupTimeoutDefault),
    shutdownTimeoutMs: codexProxyShutdownTimeoutDefault,
    shutdownGracePeriodMs: codexProxyShutdownGracePeriod,
  };
}

/** Returns the shared end-to-end deadline for one Codex execution attempt. */
export function getCodexExecutionTimeout(config = getCodexProxyConfig()): number {
  return config.startupTimeoutMs
    + config.requestTimeoutMs
    + config.shutdownGracePeriodMs
    + codexExecutionTimeoutMargin;
}

/** Converts the configured command to a shell-free executable and arguments. */
export function splitCodexProxyCommand(command: string): string[] {
  const words: string[] = [];
  let word = '';
  let quote: '"' | "'" | undefined;
  for (const character of command.trim()) {
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote === character ? undefined : character;
    } else if (/\s/.test(character) && !quote) {
      if (word) words.push(word);
      word = '';
    } else {
      word += character;
    }
  }
  if (quote || word.length === 0 && words.length === 0) {
    throw new CodexProxyError('CODEX_PROXY_COMMAND must be a complete, non-empty command.', false);
  }
  if (word) words.push(word);
  return words;
}

/** Adds only the exact rc.2 serve options, without involving a command shell. */
export function buildCodexProxyCommand(config: CodexProxyConfig): { command: string; args: string[] } {
  const [command, ...configuredArgs] = splitCodexProxyCommand(config.command);
  if (!command) throw new CodexProxyError('CODEX_PROXY_COMMAND must include an executable.', false);
  return {
    command,
    args: [
      ...configuredArgs,
      'serve',
      '--root', config.root,
      '--port', String(config.port),
      '--request-timeout', `${config.requestTimeoutMs}ms`,
      '--tool-timeout', `${config.toolTimeoutMs}ms`,
      '--shutdown-timeout', `${config.shutdownTimeoutMs}ms`,
    ],
  };
}

/** Owns one lazy proxy and coordinates all concurrent provider fetches. */
export class CodexProxyManager {
  private readonly dependencies: Required<CodexProxyDependencies>;
  private resolvedConfig: CodexProxyConfig | undefined;
  private stateValue: CodexProxyState = 'stopped';
  private child: CodexProxyChild | undefined;
  private starting: Promise<void> | undefined;
  private generation = 0;
  private stopped = false;
  private childFailure: CodexProxyError | undefined;
  private lifecycleRegistered = false;
  private readonly stderrBuffers = new Map<CodexProxyChild, string>();
  private readonly ownedChildren = new Set<CodexProxyChild>();

  /** Creates a manager with production defaults or controlled test doubles. */
  constructor(dependencies: CodexProxyDependencies = {}) {
    this.dependencies = {
      env: dependencies.env ?? process.env,
      platform: dependencies.platform ?? process.platform,
      fetch: dependencies.fetch ?? globalThis.fetch,
      spawn: dependencies.spawn ?? ((command, args, options) => spawn(command, args, options) as unknown as CodexProxyChild),
      delay: dependencies.delay ?? delay,
      now: dependencies.now ?? Date.now,
      logger: dependencies.logger ?? createLogger('CodexProxy'),
      registerShutdown: dependencies.registerShutdown ?? ((name, hook) => processManager.register(name, hook)),
      registerExit: dependencies.registerExit ?? ((handler) => process.once('exit', handler)),
      terminateTree: dependencies.terminateTree ?? terminateProcessTree,
      terminateTreeSync: dependencies.terminateTreeSync ?? terminateProcessTreeSync,
      makeDirectory: dependencies.makeDirectory ?? (async (path) => { await mkdir(path, { recursive: true }); }),
      execPath: dependencies.execPath ?? process.execPath,
      fileExists: dependencies.fileExists ?? existsSync,
      probeTimeout: dependencies.probeTimeout ?? raceProbeTimeout,
    };
  }

  /** Returns the current explicit lifecycle state. */
  get state(): CodexProxyState {
    return this.stateValue;
  }

  /** Ensures the shared proxy is authenticated, while allowing one caller to abandon only its wait. */
  async ensureCodexProxy(signal?: AbortSignal): Promise<void> {
    if (this.stopped) throw new CodexProxyError('The Codex proxy manager has stopped.', false);
    this.registerLifecycle();
    if (this.stateValue === 'ready-owned' && isChildAlive(this.child)) return;
    if (this.stateValue === 'ready-adopted') {
      const config = this.getConfig();
      const deadline = this.dependencies.now() + config.startupTimeoutMs;
      const health = await this.probe('/health', signal, deadline, config);
      const ready = await this.probe('/ready', signal, deadline, config);
      if (health?.response.ok && this.isCompatibleHealth(health.body) && ready?.response.ok && isReadyBody(ready.body)) return;
      this.clearState();
    }
    const starting = this.starting ?? this.start();
    return raceAbort(starting, signal);
  }

  /** Registers process-wide cleanup only when this manager is first used. */
  private registerLifecycle(): void {
    if (this.lifecycleRegistered) return;
    this.lifecycleRegistered = true;
    this.dependencies.registerShutdown('codex-proxy', async () => this.shutdown());
    this.dependencies.registerExit(() => this.shutdownSynchronously());
  }

  /** Invalidates a failed loopback connection so the outer retry can reacquire the proxy. */
  invalidateConnection(): void {
    if (this.stateValue === 'ready-adopted') {
      this.dependencies.logger.warn('Invalidating the Codex proxy after a loopback connection failure.');
      this.clearState();
    } else if (this.stateValue === 'ready-owned' && this.child?.pid) {
      this.dependencies.logger.warn('Restarting the owned Codex proxy after a loopback connection failure.');
      const child = this.child;
      void this.start(child);
    }
  }

  /** Gracefully stops only the proxy process this manager owns. */
  async shutdown(): Promise<void> {
    this.stopped = true;
    this.clearState();
    const ownedChildren = [...this.ownedChildren];
    if (ownedChildren.length === 0) return;
    const config = this.getConfig();
    await Promise.all(ownedChildren.map(async (child) => this.terminateOwnedChild(child, config)));
  }

  /** Performs the narrow synchronous exit-path cleanup Node permits during process exit. */
  shutdownSynchronously(): void {
    for (const child of this.ownedChildren) {
      if (child.pid && isChildAlive(child)) {
        this.dependencies.terminateTreeSync(child.pid, this.dependencies.platform);
      }
    }
  }

  /** Starts exactly one generation, preserving the promise identity shared by concurrent callers. */
  private start(childToTerminate?: CodexProxyChild): Promise<void> {
    const config = this.getConfig();
    const generation = ++this.generation;
    this.stateValue = 'starting';
    this.childFailure = undefined;
    if (childToTerminate) this.child = undefined;
    const startup = (async () => {
      if (childToTerminate) {
        await this.terminateOwnedChild(childToTerminate, config);
        if (generation !== this.generation || this.stopped) {
          throw new CodexProxyError('Codex proxy restart was stopped.', true);
        }
      }
      await this.startManagedGeneration(generation, config);
    })();
    this.starting = startup;
    void startup.then(
      () => { if (this.starting === startup) this.starting = undefined; },
      () => { if (this.starting === startup) this.starting = undefined; },
    );
    return startup;
  }

  /** Cleans up an owned partial process before exposing a failed generation to a later retry. */
  private async startManagedGeneration(generation: number, config: CodexProxyConfig): Promise<void> {
    try {
      await this.startGeneration(generation, config);
    } catch (error) {
      await this.cleanupFailedStartup(generation, config);
      throw error;
    }
  }

  /** Stops a live owned child and returns the matching failed startup to a stopped state. */
  private async cleanupFailedStartup(generation: number, config: CodexProxyConfig): Promise<void> {
    if (generation !== this.generation) return;
    const child = this.child;
    if (child) await this.terminateOwnedChild(child, config);
    if (generation === this.generation) this.clearState();
  }

  /** Adopts a compatible listener or owns a newly spawned proxy until it is ready. */
  private async startGeneration(generation: number, config: CodexProxyConfig): Promise<void> {
    const deadline = this.dependencies.now() + config.startupTimeoutMs;
    let health: Awaited<ReturnType<CodexProxyManager['probe']>>;
    try {
      health = await this.probe('/health', undefined, deadline, config);
    } catch (error) {
      if (error instanceof CodexProxyProbeTimeoutError) {
        throw new CodexProxyError(`Port ${config.port} is occupied by a service that did not answer the Codex proxy health probe.`, false, { cause: error });
      }
      throw error;
    }
    if (health?.response.ok) {
      if (!this.isCompatibleHealth(health.body)) {
        throw new CodexProxyError(`Port ${config.port} is occupied by a service that is not a compatible Codex proxy.`, false);
      }
      this.logReportedProxyVersion(health.body);
      this.child = undefined;
      await this.waitForReady(generation, config, true, deadline);
      this.installReady(generation, 'ready-adopted');
      return;
    }
    if (health) {
      throw new CodexProxyError(`Port ${config.port} is occupied and its /health endpoint returned HTTP ${health.response.status}.`, false);
    }
    await this.spawnOwned(generation, config);
    await this.waitForReady(generation, config, false, deadline);
    this.installReady(generation, 'ready-owned');
  }

  /** Launches the pinned proxy command and captures its structured stderr diagnostics. */
  private async spawnOwned(generation: number, config: CodexProxyConfig): Promise<void> {
    const invocation = buildCodexProxyCommand(config);
    try {
      await this.dependencies.makeDirectory(config.root);
    } catch (error) {
      throw new CodexProxyError(`Could not create CODEX_PROXY_ROOT: ${errorMessage(error)}`, false, { cause: error });
    }
    if (this.stopped || generation !== this.generation) {
      throw new CodexProxyError('Codex proxy startup was stopped before spawn.', true);
    }
    let child: CodexProxyChild;
    try {
      const windowsDefault = this.dependencies.platform === 'win32' && config.command === codexProxyCommandDefault;
      const npmCli = join(dirname(this.dependencies.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
      if (windowsDefault && !this.dependencies.fileExists(npmCli)) {
        throw new CodexProxyError(`Could not find npm's npx CLI at ${npmCli}.`, false);
      }
      child = this.dependencies.spawn(
        windowsDefault ? this.dependencies.execPath : invocation.command,
        windowsDefault ? [npmCli, ...invocation.args] : invocation.args,
        {
        cwd: config.root,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        detached: this.dependencies.platform !== 'win32',
        },
      );
    } catch (error) {
      if (error instanceof CodexProxyError) throw error;
      throw new CodexProxyError(`Could not launch CODEX_PROXY_COMMAND: ${errorMessage(error)}`, !isMissingTool(error));
    }
    this.ownedChildren.add(child);
    this.child = child;
    this.attachChild(generation, child);
    this.dependencies.logger.info(`Starting codex-openai-proxy@${codexProxyVersion} on port ${config.port}.`);
  }

  /** Wires generation-guarded child lifecycle events and proxy stderr forwarding. */
  private attachChild(generation: number, child: CodexProxyChild): void {
    child.on('exit', (code) => this.handleChildEnded(generation, child, `exited with code ${String(code)}`));
    child.on('error', (error) => this.handleChildError(generation, child, error));
    this.stderrBuffers.set(child, '');
    child.stderr?.on('data', (chunk: Buffer | string) => this.logProxyStderr(child, String(chunk)));
  }

  /** Logs proxy stderr a line at a time so JSON records retain their severity. */
  private logProxyStderr(child: CodexProxyChild, raw: string): void {
    const parts = `${this.stderrBuffers.get(child) ?? ''}${raw}`.split(/\r?\n/);
    this.stderrBuffers.set(child, parts.pop() ?? '');
    for (const line of parts) this.logProxyStderrLine(line);
  }

  /** Logs one complete stderr line after parsing structured records or redacting plain text. */
  private logProxyStderrLine(line: string): void {
    if (!line.trim()) return;
    try { logProxyRecord(this.dependencies.logger, JSON.parse(line)); }
    catch { this.dependencies.logger.info('Codex proxy:', redactProxyText(line)); }
  }

  /** Flushes a final non-newline stderr fragment when an owned child ends. */
  private flushProxyStderr(child: CodexProxyChild): void {
    const residual = this.stderrBuffers.get(child);
    this.stderrBuffers.delete(child);
    if (residual) this.logProxyStderrLine(residual);
  }

  /** Clears only the state owned by the matching child generation. */
  private handleChildEnded(generation: number, child: CodexProxyChild, reason: string): void {
    this.flushProxyStderr(child);
    this.ownedChildren.delete(child);
    if (generation !== this.generation || child !== this.child) return;
    this.dependencies.logger.warn(`Codex proxy ${reason}.`);
    this.clearState();
  }

  /** Retains terminal launch diagnostics so readiness polling does not misclassify them as a crash. */
  private handleChildError(generation: number, child: CodexProxyChild, error: unknown): void {
    if (generation !== this.generation || child !== this.child) return;
    this.childFailure = new CodexProxyError(
      `Could not launch CODEX_PROXY_COMMAND: ${errorMessage(error)}`,
      !isMissingTool(error),
      { cause: error },
    );
    this.handleChildEnded(generation, child, errorMessage(error));
  }

  /** Polls readiness while keeping adopted disappearance and owned crashes distinct. */
  private async waitForReady(generation: number, config: CodexProxyConfig, adopted: boolean, deadline: number): Promise<void> {
    for (;;) {
      if (this.stopped || generation !== this.generation) throw this.childFailure ?? new CodexProxyError('Codex proxy startup was stopped.', true);
      if (!adopted && !isChildAlive(this.child)) throw new CodexProxyError('The owned Codex proxy exited during startup.', true);
      let ready: Awaited<ReturnType<CodexProxyManager['probe']>>;
      try {
        ready = await this.probe('/ready', undefined, deadline, config);
      } catch (error) {
        if (error instanceof CodexProxyProbeTimeoutError) {
          if (this.dependencies.now() >= deadline) {
            throw new CodexProxyError(`Codex proxy on port ${config.port} did not become authenticated before CODEX_PROXY_STARTUP_TIMEOUT elapsed.`, false);
          }
          await this.dependencies.delay(250);
          continue;
        }
        throw error;
      }
      if (ready?.response.ok && isReadyBody(ready.body)) return;
      if (adopted && ready === undefined) {
        await this.spawnOwned(generation, config);
        adopted = false;
        continue;
      }
      if (this.dependencies.now() >= deadline) {
        throw new CodexProxyError(`Codex proxy on port ${config.port} did not become authenticated before CODEX_PROXY_STARTUP_TIMEOUT elapsed.`, false);
      }
      await this.dependencies.delay(250);
    }
  }

  /** Installs a terminal ready state only if its startup generation remains current. */
  private installReady(generation: number, state: Extract<CodexProxyState, 'ready-owned' | 'ready-adopted'>): void {
    if (this.stopped || generation !== this.generation) throw new CodexProxyError('Codex proxy startup was superseded.', true);
    this.stateValue = state;
    this.dependencies.logger.info(`Codex proxy is ready (${state === 'ready-owned' ? 'owned' : 'adopted'}).`);
  }

  /** Probes a loopback endpoint, returning undefined only for connection-level absence. */
  private async probe(
    path: '/health' | '/ready',
    signal: AbortSignal | undefined,
    deadline: number,
    config: CodexProxyConfig,
  ): Promise<{ response: Response; body: unknown } | undefined> {
    try {
      const remaining = deadline - this.dependencies.now();
      if (remaining < 1) throw new CodexProxyError('Codex proxy startup deadline elapsed while probing loopback readiness.', true);
      const operation = this.dependencies.fetch(`${getCodexProxyOrigin(config.port)}${path}`, { signal })
        .then(async (response) => {
          const text = await response.text();
          let body: unknown;
          try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
          return { response, body };
        });
      return await this.dependencies.probeTimeout(operation, Math.min(codexProxyProbeTimeoutDefault, remaining), signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('The request was aborted.', 'AbortError');
      if (error instanceof CodexProxyError || error instanceof CodexProxyProbeTimeoutError) throw error;
      if (isConnectionFailure(error)) return undefined;
      throw new CodexProxyError(`Could not probe the Codex proxy: ${errorMessage(error)}`, true, { cause: error });
    }
  }

  /** Accepts the minimal health shape without coupling adoption to a package version. */
  private isCompatibleHealth(body: unknown): boolean {
    if (!isRecord(body) || body.status !== 'ok') return false;
    const protocol = body.protocol_version ?? body.protocol;
    return protocol === undefined || protocol === '1';
  }

  /** Logs a proxy-reported version for diagnostics without using it as an adoption gate. */
  private logReportedProxyVersion(body: unknown): void {
    if (!isRecord(body)) return;
    const version = body.proxy_version ?? body.version;
    if (typeof version === 'string') this.dependencies.logger.info(`Detected Codex proxy version ${redactProxyText(version)}.`);
  }

  /** Resets volatile lifecycle fields while invalidating every earlier child generation. */
  private clearState(): void {
    this.generation += 1;
    this.child = undefined;
    this.stateValue = 'stopped';
  }

  /** Resolves this manager's injected environment once, after application configuration has loaded. */
  private getConfig(): CodexProxyConfig {
    this.resolvedConfig ??= getCodexProxyConfig(this.dependencies.env);
    return this.resolvedConfig;
  }

  /** Terminates one owned child and forgets it only after its process has ended. */
  private async terminateOwnedChild(child: CodexProxyChild, config: CodexProxyConfig): Promise<void> {
    if (!child.pid || !isChildAlive(child)) {
      this.ownedChildren.delete(child);
      return;
    }
    await this.dependencies.terminateTree(child.pid, false, this.dependencies.platform);
    const ended = await waitForExit(child, this.dependencies.now, this.dependencies.delay, config.shutdownGracePeriodMs);
    if (!ended) await this.dependencies.terminateTree(child.pid, true, this.dependencies.platform);
    if (!isChildAlive(child)) this.ownedChildren.delete(child);
  }
}

/** Parses a bounded decimal environment variable. */
function parseInteger(name: string, value: string, minimum: number, maximum: number): number {
  value = value.trim();
  if (!/^\d+$/.test(value)) throw new CodexProxyError(`${name} must be an integer.`, false);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new CodexProxyError(`${name} must be between ${minimum} and ${maximum}.`, false);
  }
  return number;
}

/** Parses the same millisecond, second, and minute duration contour accepted by rc.2. */
function parseDuration(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  value = value.trim();
  const match = /^(\d+)(ms|s|m)?$/.exec(value);
  if (!match) throw new CodexProxyError(`${name} must be a duration such as 500ms, 30s, or 5m.`, false);
  const amount = Number(match[1]);
  const multiplier = match[2] === 'm' ? 60_000 : match[2] === 's' ? 1_000 : 1;
  const result = amount * multiplier;
  if (!Number.isSafeInteger(result) || result < 1 || result > 2 ** 31 - 1) {
    throw new CodexProxyError(`${name} must be a positive duration.`, false);
  }
  return result;
}

/** Sleeps without retaining the process when no other work remains. */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

/** Bounds one loopback probe without cancelling a caller's separately supplied abort signal. */
function raceProbeTimeout<T>(operation: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CodexProxyProbeTimeoutError()), timeoutMs);
    const abort = () => reject(signal?.reason ?? new DOMException('The request was aborted.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    void operation.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    });
  });
}

/** Waits for one caller's cancellation without cancelling the manager's shared startup. */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('The request was aborted.', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('The request was aborted.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Returns true only while a concrete child still has an active event-loop handle. */
function isChildAlive(child: CodexProxyChild | undefined): boolean {
  return child !== undefined && child.exitCode === null && !child.killed;
}

/** Recognizes the ready payload emitted by the audited rc.2 server. */
function isReadyBody(body: unknown): boolean {
  return isRecord(body) && body.status === 'ready';
}

/** Narrows an unknown JSON payload to a record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Identifies transport failures that mean the loopback listener is absent. */
function isConnectionFailure(error: unknown): boolean {
  const code = isRecord(error) ? error.code : undefined;
  return code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOTFOUND' || error instanceof TypeError;
}

/** Identifies the common command-not-found errors as terminal operator setup failures. */
function isMissingTool(error: unknown): boolean {
  const code = isRecord(error) ? error.code : undefined;
  return code === 'ENOENT';
}

/** Treats blank .env placeholders as omitted while retaining invalid nonblank values. */
function optionalEnvironmentValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/** Converts arbitrary caught values into a compact safe diagnostic. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Routes one proxy structured stderr record through Winston after removing secret-looking fields. */
function redactProxyRecord(value: unknown): unknown {
  if (typeof value === 'string') return redactProxyText(value);
  if (Array.isArray(value)) return value.map(redactProxyRecord);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /token|secret|password|authorization|cookie|api.?key|(?:device|user).?code/i.test(key) ? '[redacted]' : redactProxyRecord(item),
  ]));
}

/** Removes credentials from plain stderr while preserving device-login links and instructions. */
function redactProxyText(value: string): string {
  return value
    .replace(/(bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[redacted]')
    .replace(/([?&](?:(?:access|refresh|id|device|user)_?)?(?:token|code)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/((?:(?:access|refresh|id|device|user)[ _-]?(?:token|code)|token|secret|password|authorization|api[ _-]?key)\s*[:=]\s*)[^\s,]+/gi, '$1[redacted]');
}

/** Sends structured proxy stderr records to the matching Winston method without leaking credentials. */
function logProxyRecord(logger: Pick<ReturnType<typeof createLogger>, 'debug' | 'info' | 'warn' | 'error'>, record: unknown): void {
  const safe = redactProxyRecord(record);
  const level = isRecord(record) && typeof record.level === 'string' && ['debug', 'info', 'warn', 'error'].includes(record.level)
    ? record.level as 'debug' | 'info' | 'warn' | 'error'
    : 'info';
  logger[level]('Codex proxy:', safe);
}

/** Waits for a child to exit without relying on a platform-specific process polling API. */
async function waitForExit(child: CodexProxyChild, now: () => number, wait: (milliseconds: number) => Promise<void>, timeout: number): Promise<boolean> {
  const deadline = now() + timeout;
  while (isChildAlive(child) && now() < deadline) await wait(100);
  return !isChildAlive(child);
}

/** Terminates an owned process group on POSIX or a Windows process tree with taskkill. */
async function terminateProcessTree(pid: number, force: boolean, platform: NodeJS.Platform): Promise<void> {
  if (platform === 'win32') {
    await new Promise<void>((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], () => resolve()));
    return;
  }
  try { process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM'); }
  catch { /* The child may already have exited. */ }
}

/** Makes the synchronous exit handler do its best to terminate only an owned child tree. */
function terminateProcessTreeSync(pid: number, platform: NodeJS.Platform): void {
  try {
    if (platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGTERM');
  } catch { /* Process exit cannot safely recover from an already-gone child. */ }
}

/** Module singleton used by the provider's custom fetch implementation. */
export const codexProxyManager = new CodexProxyManager();

/** Awaits the module singleton for provider code that needs no manager-specific access. */
export function ensureCodexProxy(signal?: AbortSignal): Promise<void> {
  return codexProxyManager.ensureCodexProxy(signal);
}
