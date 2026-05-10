/**
 * Integration test for VoxCivilization - Tests real Civilization V process management
 * WARNING: This test actually launches and kills Civilization V
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VoxCivilization } from '../../src/infra/vox-civilization.js';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { setTimeout } from 'node:timers/promises';

const execAsync = promisify(exec);

/**
 * Guard: abort game tests if CivilizationV.exe is already running.
 * Only one Civ5 instance can run at a time. If one is already active, it may be
 * a live game session — we must not kill it, so we skip game tests instead.
 */
function assertNoCivilizationRunning(): void {
  if (process.platform !== 'win32') return;
  try {
    const output = execSync(
      'tasklist /FI "IMAGENAME eq CivilizationV.exe" /FO CSV',
      { encoding: 'utf-8' }
    );
    if (output.includes('CivilizationV.exe')) {
      throw new Error(
        'CivilizationV.exe is already running. ' +
        'Only one instance can run at a time. ' +
        'Please close Civilization V before running game tests.'
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('CivilizationV.exe is already running')) {
      throw e;
    }
    // tasklist command failed — safe to continue
  }
}

/**
 * Kill any existing Civilization V processes
 */
async function killAllCivilizationProcesses(): Promise<void> {
  try {
    console.log('Attempting to kill any existing CivilizationV.exe processes...');
    await execAsync('taskkill /F /IM CivilizationV.exe');
    console.log('Successfully killed existing processes');
  } catch (error) {
    // Process might not exist, which is fine
    console.log('No existing CivilizationV.exe process found (or failed to kill)');
  }
  // Wait a bit for process to fully terminate
  await setTimeout(3000);
}

/**
 * Check if Civilization V is running
 */
async function isCivilizationRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq CivilizationV.exe" /FO CSV');
    return stdout.includes('CivilizationV.exe');
  } catch {
    return false;
  }
}

describe('VoxCivilization Integration Test', () => {
  let voxCiv: VoxCivilization;

  beforeAll(() => {
    assertNoCivilizationRunning();
  });

  afterAll(async () => {
    console.log('\n=== Cleaning up after test ===');

    // Cleanup the VoxCivilization instance
    if (voxCiv) {
      voxCiv.destroy();
    }

    // Make sure to kill any remaining processes
    await killAllCivilizationProcesses();

    console.log('Cleanup complete');
  }, 30000);

  it('should detect and kill already running Civilization V process', async () => {
    console.log('\n=== Starting VoxCivilization Integration Test ===');
    console.log('This test will launch and control real Civilization V process');

    // Create VoxCivilization instance first
    voxCiv = new VoxCivilization();

    // Use VoxCivilization's detection to check if Civ is already running
    console.log('\n--- Using VoxCivilization to detect existing processes ---');
    const detected = await voxCiv.startGame('LoadMods.lua');

    if (voxCiv.isGameRunning()) {
      const pid = voxCiv.getProcessId();
      console.log(`VoxCivilization detected existing process (PID: ${pid})`);
      console.log('Killing detected process using VoxCivilization...');

      const killed = await voxCiv.killGame();
      if (killed) {
        console.log('Successfully killed existing process via VoxCivilization');
      } else {
        console.log('Failed to kill via VoxCivilization, attempting manual kill...');
        await killAllCivilizationProcesses();
      }

      // Wait for cleanup
      await setTimeout(3000);
    } else {
      console.log('No existing process detected by VoxCivilization');
    }

    // Verify clean slate
    const stillRunning = await isCivilizationRunning();
    expect(stillRunning).toBe(false);
  }, 90000);

  it('should manage Civilization V lifecycle: start, monitor for 2 minutes, then kill', async () => {
    // Test parameters
    const MONITOR_DURATION_MS = 5 * 60 * 1000; // 2 minutes
    const CHECK_INTERVAL_MS = 10000; // Check every 10 seconds

    console.log('\n--- Phase 1: Verify no game is running ---');
    expect(voxCiv.isGameRunning()).toBe(false);
    expect(voxCiv.getProcessId()).toBe(null);

    console.log('\n--- Phase 2: Start Civilization V ---');
    console.log('Launching game with LoadMods.lua script...');

    // Set up exit callback to track if game exits unexpectedly
    let unexpectedExit = false;
    let exitCode: number | null = null;

    voxCiv.onGameExit((code) => {
      console.log(`Game exit detected with code: ${code}`);
      unexpectedExit = true;
      exitCode = code;
    });

    // Start the game
    const started = await voxCiv.startGame('LoadMods.lua');
    expect(started).toBe(true);

    // Verify game is running
    expect(voxCiv.isGameRunning()).toBe(true);
    const pid = voxCiv.getProcessId();
    expect(pid).not.toBe(null);
    console.log(`Game started successfully with PID: ${pid}`);

    // Verify through Windows tasklist as well
    const isRunning = await isCivilizationRunning();
    expect(isRunning).toBe(true);

    console.log('\n--- Phase 3: Monitor game for 2 minutes ---');
    console.log(`Monitoring game process (PID: ${pid}) for ${MONITOR_DURATION_MS / 1000} seconds...`);
    console.log('Progress updates every 10 seconds:');

    const startTime = Date.now();
    let checkCount = 0;

    // Monitor for the specified duration
    while (Date.now() - startTime < MONITOR_DURATION_MS) {
      await setTimeout(CHECK_INTERVAL_MS);
      checkCount++;

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const remaining = Math.round((MONITOR_DURATION_MS - (Date.now() - startTime)) / 1000);

      // Check if game is still running
      const stillRunning = voxCiv.isGameRunning();
      const currentPid = voxCiv.getProcessId();
      const systemCheck = await isCivilizationRunning();

      console.log(`  [${checkCount}] ${elapsed}s elapsed, ${remaining}s remaining - Game running: ${stillRunning}, PID: ${currentPid}, System check: ${systemCheck}`);

      // Verify game hasn't crashed
      if (!stillRunning || unexpectedExit) {
        throw new Error(`Game exited unexpectedly during monitoring! Exit code: ${exitCode}`);
      }

      expect(stillRunning).toBe(true);
      expect(currentPid).toBe(pid);
      expect(systemCheck).toBe(true);
    }

    console.log('\n--- Phase 4: Kill the game process ---');
    console.log('Monitoring complete, now killing the game using VoxCivilization...');

    // Use VoxCivilization's killGame method
    const killSuccess = await voxCiv.killGame();
    expect(killSuccess).toBe(true);

    // Verify game has stopped
    expect(voxCiv.isGameRunning()).toBe(false);
    expect(voxCiv.getProcessId()).toBe(null);

    // Double-check with system
    const finalCheck = await isCivilizationRunning();
    expect(finalCheck).toBe(false);

    console.log('Game successfully killed and verified stopped');
    console.log('\n=== Integration test completed successfully ===');
  }, 180000); // 3 minute timeout for the test (2 min monitoring + overhead)
});
