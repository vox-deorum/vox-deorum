import { spawn, ChildProcess } from 'child_process';
import { setTimeout } from 'node:timers/promises';
import path from 'path';

/**
 * Global setup for the mcp-server **real** test tier (USE_MOCK=false).
 *
 * Spins up the real bridge-service via its `start:mock` entry — a fully real
 * bridge wired to an in-process mock DLL — so the stack bottoms out at the mock,
 * never a live Civilization V game. The mcp-server itself is started by
 * `tests/setup.ts` (setupFiles), which connects to this bridge. Net chain:
 *   mcp-server  ->  real bridge  ->  mock DLL    (no Civ V; CI-able)
 */

let bridgeServiceProcess: ChildProcess | null = null;
const BRIDGE_SERVICE_URL = process.env.BRIDGE_SERVICE_URL || 'http://127.0.0.1:5000';
const CONNECTION_TIMEOUT = 30000;
const BRIDGE_SERVICE_PATH = path.resolve('../bridge-service');

async function checkBridgeConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${BRIDGE_SERVICE_URL}/health`);
    if (!response.ok) return false;
    const healthData = await response.json();
    return healthData.result?.dll_connected === true;
  } catch {
    return false;
  }
}

async function waitForBridgeService(): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < CONNECTION_TIMEOUT) {
    if (await checkBridgeConnection()) return true;
    await setTimeout(500);
  }
  return false;
}

async function startBridgeService(): Promise<void> {
  if (await checkBridgeConnection()) {
    console.log('Bridge Service (mock DLL) already running and connected.');
    return;
  }
  console.log('Starting Bridge Service in mock-DLL mode for tests...');

  // `start:mock` boots the real bridge against an in-process MockDLLServer.
  bridgeServiceProcess = spawn('npm', ['run', 'start:mock'], {
    cwd: BRIDGE_SERVICE_PATH,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  bridgeServiceProcess.stdout?.on('data', (d) => console.log(`Bridge: ${d.toString().trim()}`));
  bridgeServiceProcess.stderr?.on('data', (d) => console.error(`Bridge Error: ${d.toString().trim()}`));
  bridgeServiceProcess.on('error', (e) => console.error('Failed to start Bridge Service:', e));

  if (!(await waitForBridgeService())) {
    throw new Error('Mock bridge did not become ready (dll_connected) within timeout');
  }
  console.log('✅ Mock bridge ready and connected.');
}

async function stopBridgeService(): Promise<void> {
  if (!bridgeServiceProcess) return;
  console.log('Stopping Bridge Service...');
  const pid = bridgeServiceProcess.pid;

  const exitPromise = new Promise<void>((resolve) => {
    bridgeServiceProcess?.once('exit', () => resolve());
  });

  try {
    if (process.platform === 'win32' && pid) {
      const { exec } = await import('child_process');
      exec(`taskkill /F /T /PID ${pid}`, (error) => {
        if (error) bridgeServiceProcess?.kill('SIGTERM');
      });
    } else {
      bridgeServiceProcess.kill('SIGTERM');
      await setTimeout(2000);
      if (!bridgeServiceProcess.killed) bridgeServiceProcess.kill('SIGKILL');
    }
    await exitPromise;
  } catch (error) {
    console.error('Error stopping Bridge Service:', error);
  } finally {
    bridgeServiceProcess = null;
    console.log('Bridge Service stopped');
  }
}

export async function setup() {
  await startBridgeService();
}

export async function teardown() {
  await stopBridgeService();
}
