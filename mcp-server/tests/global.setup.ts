import { spawn, ChildProcess } from 'child_process';
import { setTimeout } from 'node:timers/promises';
import path from 'path';

let bridgeServiceProcess: ChildProcess | null = null;
const BRIDGE_SERVICE_URL = 'http://127.0.0.1:5000';
const CONNECTION_TIMEOUT = 10000; // 10 seconds
const BRIDGE_SERVICE_PATH = path.resolve('../bridge-service');

/**
 * Check if bridge service is responding and DLL is connected
 */
async function checkBridgeConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${BRIDGE_SERVICE_URL}/health`);
    if (!response.ok) {
      return false;
    }
    const healthData = await response.json();
    return healthData.result?.dll_connected === true;
  } catch {
    return false;
  }
}

/**
 * Wait for bridge service to be ready with timeout
 */
async function waitForBridgeService(): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < CONNECTION_TIMEOUT) {
    if (await checkBridgeConnection()) {
      return true;
    }
    await setTimeout(500);
  }

  return false;
}

/**
 * Start bridge service in real mode
 */
async function startBridgeService(): Promise<void> {
  if (await checkBridgeConnection()) {
    console.log('Bridge Service is already running and connected.');
    return;
  } else {
    console.log('Starting Bridge Service for tests...');
  }

  bridgeServiceProcess = spawn('npm', ['start'], {
    cwd: BRIDGE_SERVICE_PATH,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
  });

  if (bridgeServiceProcess.stdout) {
    bridgeServiceProcess.stdout.on('data', (data) => {
      console.log(`Bridge Service: ${data.toString().trim()}`);
    });
  }

  if (bridgeServiceProcess.stderr) {
    bridgeServiceProcess.stderr.on('data', (data) => {
      console.error(`Bridge Service Error: ${data.toString().trim()}`);
    });
  }

  bridgeServiceProcess.on('error', (error) => {
    console.error('Failed to start Bridge Service:', error);
  });

  // Wait for service to be ready
  const isReady = await waitForBridgeService();

  if (!isReady) {
    console.warn('\n⚠️  WARNING: Bridge Service did not start within timeout!');
    console.warn('This likely means Civilization V is not running.');
    console.warn('Some tests may fail if they require the bridge service.');
    console.warn('To run full integration tests, please:');
    console.warn('1. Start Civilization V');
    console.warn('2. Load the Community Patch mod');
    console.warn('3. Run tests again\n');
    throw new Error('Bridge Service is not ready');
  } else {
    console.log('✅ Bridge Service is ready and connected!');
  }
}

/**
 * Stop bridge service
 */
async function stopBridgeService(): Promise<void> {
  if (!bridgeServiceProcess) return;
  console.log('Stopping Bridge Service...');

  const pid = bridgeServiceProcess.pid;

  // Create a promise that resolves when the process exits
  const exitPromise = new Promise<void>((resolve) => {
    if (!bridgeServiceProcess) {
      resolve();
      return;
    }

    bridgeServiceProcess.once('exit', () => {
      console.log('Bridge Service process exited');
      resolve();
    });
  });

  try {
    // On Windows, use taskkill to kill the process tree
    if (process.platform === 'win32' && pid) {
      const { exec } = await import('child_process');
      // Kill the process tree (the process and all its children)
      exec(`taskkill /F /T /PID ${pid}`, (error) => {
        if (error) {
          console.log('Failed to kill process with taskkill:', error.message);
          // Try normal kill as fallback
          bridgeServiceProcess?.kill('SIGTERM');
        }
      });
    } else {
      // On Unix-like systems, use SIGTERM then SIGKILL
      bridgeServiceProcess.kill('SIGTERM');

      // Give it 2 seconds to gracefully shut down
      await setTimeout(2000);

      // Force kill if still running
      if (!bridgeServiceProcess.killed) {
        bridgeServiceProcess.kill('SIGKILL');
      }
    }

    // Wait for the process to actually exit
    await exitPromise;

  } catch (error) {
    console.error('Error stopping Bridge Service:', error);
  } finally {
    bridgeServiceProcess = null;
    console.log('Bridge Service stopped');
  }
}

/**
 * Global setup for Vitest
 */
export async function setup() {
  await startBridgeService();
}

/**
 * Global teardown for Vitest
 */
export async function teardown() {
  await stopBridgeService();
}
