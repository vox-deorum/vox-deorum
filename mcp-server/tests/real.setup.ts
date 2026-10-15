import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Own an isolated mock-DLL bridge for this real-tier run. */
let bridgeServiceProcess: ChildProcess | undefined;
let bridgeUrl: string;
const CONNECTION_TIMEOUT = 30000;
const BRIDGE_SERVICE_PATH = path.resolve('../bridge-service');
const BRIDGE_TEST_BOOTSTRAP = path.resolve('tests/fixtures/start-bridge.ts');

/** Reserve an available loopback port for the bridge process. */
async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a bridge port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

/** Check readiness of the bridge instance started for this run. */
async function checkBridgeConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${bridgeUrl}/health`);
    if (!response.ok) return false;
    const health = await response.json() as { result?: { dll_connected?: boolean } };
    return health.result?.dll_connected === true;
  } catch {
    return false;
  }
}

/** Wait for the isolated mock bridge to accept requests. */
async function waitForBridgeService(): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < CONNECTION_TIMEOUT) {
    if (bridgeServiceProcess?.exitCode !== null && bridgeServiceProcess?.exitCode !== undefined) return false;
    if (await checkBridgeConnection()) return true;
    await setTimeout(100);
  }
  return false;
}

/** Stop only the child process owned by this test run. */
async function stopBridgeService(): Promise<void> {
  const child = bridgeServiceProcess;
  if (!child) return;
  bridgeServiceProcess = undefined;

  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  if (process.platform === 'win32' && child.pid) {
    const { execFile } = await import('node:child_process');
    await new Promise<void>(resolve => {
      execFile('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true }, () => resolve());
    });
  } else {
    child.kill('SIGTERM');
  }
  await Promise.race([exited, setTimeout(3000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

/** Start an isolated mock bridge and publish its URL to test workers. */
export async function setup(): Promise<void> {
  const port = await findFreePort();
  const bridgeId = `vox-deorum-mcp-test-${process.pid}-${randomUUID()}`;
  const eventPipeName = `vox-deorum-events-test-${process.pid}-${randomUUID()}`;
  bridgeUrl = `http://127.0.0.1:${port}`;
  process.env.BRIDGE_SERVICE_URL = bridgeUrl;
  process.env.BRIDGE_SERVICE_HOST = '127.0.0.1';
  process.env.BRIDGE_SERVICE_PORT = String(port);
  process.env.EVENTPIPE_ENABLED = 'false';
  process.env.EVENTPIPE_NAME = eventPipeName;

  bridgeServiceProcess = spawn(process.execPath, ['--import', 'tsx', BRIDGE_TEST_BOOTSTRAP], {
    cwd: BRIDGE_SERVICE_PATH,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      EVENTPIPE_ENABLED: 'false',
      EVENTPIPE_NAME: eventPipeName,
      gamepipe_ID: bridgeId,
    },
  });

  const ready = await waitForBridgeService();
  if (!ready) {
    await stopBridgeService();
    throw new Error('The isolated mock bridge did not become ready within 30 seconds');
  }
}

/** Stop the bridge process owned by this global setup. */
export async function teardown(): Promise<void> {
  await stopBridgeService();
}
