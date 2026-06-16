/**
 * Mock-tier unit tests for the Civ5 process-lifecycle manager
 * (src/infra/vox-civilization.ts). The OS/process seams are fully mocked:
 * the utils/game/* helpers (civ5-ini, civ5-user-files, windows-process),
 * fs/promises read/write, and child_process.spawn. No real Civilization V
 * is launched. The live-game coverage lives in tests/live/game/.
 *
 * Assertions target state transitions, helper call args, and counters —
 * never logger text.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// --- Mock the OS/process seams (paths relative to the SOURCE file) ---

vi.mock('../../../src/utils/game/civ5-ini.js', () => ({
  readCivConfigSeedsContent: vi.fn(),
  updateCivConfigSeedsContent: vi.fn(),
  updateCivUserSettingsSkipAnimationsContent: vi.fn(),
}));

vi.mock('../../../src/utils/game/civ5-user-files.js', () => ({
  getCiv5UserFilePath: vi.fn(),
}));

vi.mock('../../../src/utils/game/windows-process.js', () => ({
  findProcessByImageName: vi.fn(),
  isProcessRunning: vi.fn(),
  killProcess: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

// Collapse the post-kill / post-launch sleeps so tests don't block on wall time.
vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn(() => Promise.resolve()),
}));

// Fake child process returned by spawn(): an EventEmitter exposing the
// surface the source touches (.on for 'exit'/'error', .pid, .kill).
class FakeChild extends EventEmitter {
  pid = 4242;
  kill = vi.fn();
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));
// The source imports from 'child_process' (no node: prefix); alias both so
// whichever specifier resolves, it lands on the same stub.
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { VoxCivilization } from '../../../src/infra/vox-civilization.js';
import {
  readCivConfigSeedsContent,
  updateCivConfigSeedsContent,
} from '../../../src/utils/game/civ5-ini.js';
import { getCiv5UserFilePath } from '../../../src/utils/game/civ5-user-files.js';
import {
  findProcessByImageName,
  isProcessRunning,
  killProcess,
} from '../../../src/utils/game/windows-process.js';
import { readFile, writeFile } from 'fs/promises';
import { spawn } from 'child_process';

const mReadConfigSeeds = vi.mocked(readCivConfigSeedsContent);
const mUpdateConfigSeeds = vi.mocked(updateCivConfigSeedsContent);
const mGetUserFilePath = vi.mocked(getCiv5UserFilePath);
const mFindProcess = vi.mocked(findProcessByImageName);
const mIsRunning = vi.mocked(isProcessRunning);
const mKillProcess = vi.mocked(killProcess);
const mReadFile = vi.mocked(readFile);
const mWriteFile = vi.mocked(writeFile);
const mSpawn = vi.mocked(spawn);

const CONFIG_PATH = '/docs/My Games/Civ5/config.ini';

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible neutral defaults; individual tests override as needed.
  mGetUserFilePath.mockResolvedValue(CONFIG_PATH);
  mReadFile.mockResolvedValue('[CONFIG]\n');
  mWriteFile.mockResolvedValue(undefined as never);
  mReadConfigSeeds.mockReturnValue({ sync: '111', map: '222' });
  mUpdateConfigSeeds.mockImplementation(() => 'UPDATED');
  mFindProcess.mockResolvedValue(null);
  mIsRunning.mockResolvedValue(true);
  mKillProcess.mockResolvedValue(undefined);
});

describe('VoxCivilization (mock tier)', () => {
  describe('seed save -> restore round-trip', () => {
    it('captures the original seeds, writes new ones, then restores the captured values', async () => {
      mReadConfigSeeds.mockReturnValue({ sync: '777', map: '888' });
      const civ = new VoxCivilization();

      // Save: applyRandomSeeds reads config.ini, captures original, writes new.
      await civ.applyRandomSeeds({ sync: 5, map: 9 });

      expect(mGetUserFilePath).toHaveBeenCalledWith('config.ini');
      // Original values were read before overwriting.
      expect(mReadConfigSeeds).toHaveBeenCalledWith('[CONFIG]\n');
      // New seeds written as numbers.
      expect(mUpdateConfigSeeds).toHaveBeenCalledWith('[CONFIG]\n', { sync: 5, map: 9 });
      expect(mWriteFile).toHaveBeenCalledWith(CONFIG_PATH, 'UPDATED', 'utf-8');

      mUpdateConfigSeeds.mockClear();
      mWriteFile.mockClear();

      // Restore: the captured original seed strings are written back.
      await civ.restoreRandomSeeds();

      expect(mUpdateConfigSeeds).toHaveBeenCalledWith('[CONFIG]\n', { sync: '777', map: '888' });
      expect(mWriteFile).toHaveBeenCalledWith(CONFIG_PATH, 'UPDATED', 'utf-8');
    });

    it('defaults omitted seeds to 0 on save and defaults missing captured values to "0"', async () => {
      mReadConfigSeeds.mockReturnValue({}); // config had neither side set
      const civ = new VoxCivilization();

      await civ.applyRandomSeeds(); // no seeds provided

      expect(mUpdateConfigSeeds).toHaveBeenCalledWith('[CONFIG]\n', { sync: 0, map: 0 });

      mUpdateConfigSeeds.mockClear();
      await civ.restoreRandomSeeds();

      // Captured fallbacks were '0'/'0'.
      expect(mUpdateConfigSeeds).toHaveBeenCalledWith('[CONFIG]\n', { sync: '0', map: '0' });
    });

    it('restoreRandomSeeds is a no-op when no seeds were ever applied', async () => {
      const civ = new VoxCivilization();

      await civ.restoreRandomSeeds();

      expect(mUpdateConfigSeeds).not.toHaveBeenCalled();
      expect(mWriteFile).not.toHaveBeenCalled();
    });

    it('only captures the original once across repeated applyRandomSeeds calls', async () => {
      mReadConfigSeeds
        .mockReturnValueOnce({ sync: 'orig', map: 'origmap' })
        .mockReturnValue({ sync: '999', map: '999' });
      const civ = new VoxCivilization();

      await civ.applyRandomSeeds({ sync: 1, map: 1 });
      await civ.applyRandomSeeds({ sync: 2, map: 2 });

      mUpdateConfigSeeds.mockClear();
      await civ.restoreRandomSeeds();

      // Restores the FIRST captured original, not the second read.
      expect(mUpdateConfigSeeds).toHaveBeenCalledWith('[CONFIG]\n', { sync: 'orig', map: 'origmap' });
    });
  });

  describe('bind-to-existing-process', () => {
    it('binds to a discovered PID without spawning when a process already exists', async () => {
      mFindProcess.mockResolvedValue(31337);
      const civ = new VoxCivilization();

      const started = await civ.startGame('LoadMods.lua');

      expect(started).toBe(true);
      expect(mFindProcess).toHaveBeenCalledWith('CivilizationV.exe');
      // Bound to the existing process: no spawn, no seed rewrite, state reflects PID.
      expect(mSpawn).not.toHaveBeenCalled();
      expect(mUpdateConfigSeeds).not.toHaveBeenCalled();
      expect(civ.isGameRunning()).toBe(true);
      expect(civ.getProcessId()).toBe(31337);

      civ.destroy();
    });

    it('reports not running and null PID before any bind', () => {
      const civ = new VoxCivilization();
      expect(civ.isGameRunning()).toBe(false);
      expect(civ.getProcessId()).toBe(null);
    });
  });

  describe('exit-callback registration and firing', () => {
    it('fires all registered callbacks with the exit code, then clears running state', async () => {
      mFindProcess.mockResolvedValue(555);
      const civ = new VoxCivilization();
      await civ.startGame('LoadMods.lua'); // bind so monitoring=true

      const cbA = vi.fn();
      const cbB = vi.fn();
      civ.onGameExit(cbA);
      civ.onGameExit(cbB);

      // killGame drives handleGameExit(-1) through the mocked killProcess.
      const killed = await civ.killGame();

      expect(killed).toBe(true);
      expect(mKillProcess).toHaveBeenCalledWith(555);
      expect(cbA).toHaveBeenCalledWith(-1);
      expect(cbB).toHaveBeenCalledWith(-1);
      expect(civ.isGameRunning()).toBe(false);
      expect(civ.getProcessId()).toBe(null);

      civ.destroy();
    });

    it('does not fire a callback that was unregistered via offGameExit', async () => {
      mFindProcess.mockResolvedValue(556);
      const civ = new VoxCivilization();
      await civ.startGame('LoadMods.lua');

      const cb = vi.fn();
      civ.onGameExit(cb);
      civ.offGameExit(cb);

      await civ.killGame();

      expect(cb).not.toHaveBeenCalled();
      civ.destroy();
    });

    it('isolates a throwing callback so siblings still fire', async () => {
      mFindProcess.mockResolvedValue(557);
      const civ = new VoxCivilization();
      await civ.startGame('LoadMods.lua');

      const boom = vi.fn(() => { throw new Error('callback boom'); });
      const survivor = vi.fn();
      civ.onGameExit(boom);
      civ.onGameExit(survivor);

      await expect(civ.killGame()).resolves.toBe(true);
      expect(boom).toHaveBeenCalled();
      expect(survivor).toHaveBeenCalledWith(-1);

      civ.destroy();
    });

    it('destroy() clears callbacks so a later exit fires nothing', async () => {
      mFindProcess.mockResolvedValue(558);
      const civ = new VoxCivilization();
      await civ.startGame('LoadMods.lua');

      const cb = vi.fn();
      civ.onGameExit(cb);
      civ.destroy();

      await civ.killGame();

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('monitoring detects a dead process (crash detection)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('fires the exit callback once the poll sees the process is gone', async () => {
      mFindProcess.mockResolvedValue(909);
      const civ = new VoxCivilization();
      await civ.startGame('LoadMods.lua');

      const onExit = vi.fn();
      civ.onGameExit(onExit);
      expect(civ.isGameRunning()).toBe(true);

      // Process is still alive on the first poll, then disappears.
      mIsRunning.mockResolvedValueOnce(true).mockResolvedValue(false);

      // First poll tick: still running.
      await vi.advanceTimersByTimeAsync(5000);
      expect(onExit).not.toHaveBeenCalled();
      expect(civ.isGameRunning()).toBe(true);

      // Second poll tick: gone -> exit with code 0, monitoring stops.
      await vi.advanceTimersByTimeAsync(5000);
      expect(mIsRunning).toHaveBeenCalledWith(909);
      expect(onExit).toHaveBeenCalledWith(0);
      expect(civ.isGameRunning()).toBe(false);
      expect(civ.getProcessId()).toBe(null);

      civ.destroy();
    });
  });

  describe('crash-recovery / launch-failure handling', () => {
    it('restores seeds when the launch script fails for a brand-new StartGame', async () => {
      // No existing process -> proceeds to spawn the launch script.
      mFindProcess.mockResolvedValue(null);
      mReadConfigSeeds.mockReturnValue({ sync: 'origSync', map: 'origMap' });

      const child = new FakeChild();
      mSpawn.mockReturnValue(child as never);

      const civ = new VoxCivilization();
      const promise = civ.startGame('StartGame.lua');

      // Let applyRandomSeeds + the spawn-promise setup flush so the child's
      // 'exit' listener is registered before we emit.
      await vi.waitFor(() => expect(mSpawn).toHaveBeenCalled());

      // Make the launch script fail.
      child.emit('exit', 1);

      const started = await promise;

      expect(started).toBe(false);
      // Seeds were applied (saved as 0/0) before launching...
      expect(mUpdateConfigSeeds).toHaveBeenCalledWith('[CONFIG]\n', { sync: 0, map: 0 });
      // ...then recovery restored the captured originals after the failed launch.
      expect(mUpdateConfigSeeds).toHaveBeenLastCalledWith('[CONFIG]\n', {
        sync: 'origSync',
        map: 'origMap',
      });

      civ.destroy();
    });

    it('killGame is a safe no-op (returns true, no taskkill) when nothing is bound', async () => {
      const civ = new VoxCivilization();

      const killed = await civ.killGame();

      expect(killed).toBe(true);
      expect(mKillProcess).not.toHaveBeenCalled();
    });
  });
});
