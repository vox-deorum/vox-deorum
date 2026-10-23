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

// The map script helpers stay real so tests can read back the written config.ini.
vi.mock('../../../src/utils/game/civ5-ini.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/utils/game/civ5-ini.js')>();
  return {
    readCivConfigMapScriptContent: actual.readCivConfigMapScriptContent,
    updateCivConfigMapScriptContent: actual.updateCivConfigMapScriptContent,
    readCivConfigSeedsContent: vi.fn(),
    updateCivConfigLegacyMapScriptContent: vi.fn((content: string) => content),
    updateCivConfigSeedsContent: vi.fn(),
    updateCivUserSettingsSkipAnimationsContent: vi.fn(),
  };
});

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
  mkdir: vi.fn(),
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
  readCivConfigMapScriptContent,
  readCivConfigSeedsContent,
  updateCivConfigSeedsContent,
} from '../../../src/utils/game/civ5-ini.js';
import { getCiv5UserFilePath } from '../../../src/utils/game/civ5-user-files.js';
import {
  findProcessByImageName,
  isProcessRunning,
  killProcess,
} from '../../../src/utils/game/windows-process.js';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const mReadConfigSeeds = vi.mocked(readCivConfigSeedsContent);
const mUpdateConfigSeeds = vi.mocked(updateCivConfigSeedsContent);
const mGetUserFilePath = vi.mocked(getCiv5UserFilePath);
const mFindProcess = vi.mocked(findProcessByImageName);
const mIsRunning = vi.mocked(isProcessRunning);
const mKillProcess = vi.mocked(killProcess);
const mReadFile = vi.mocked(readFile);
const mWriteFile = vi.mocked(writeFile);
const mMkdir = vi.mocked(mkdir);
const mSpawn = vi.mocked(spawn);

const CONFIG_PATH = '/docs/My Games/Civ5/config.ini';

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible neutral defaults; individual tests override as needed.
  mGetUserFilePath.mockResolvedValue(CONFIG_PATH);
  mReadFile.mockResolvedValue('[CONFIG]\n');
  mWriteFile.mockResolvedValue(undefined as never);
  mMkdir.mockResolvedValue(undefined);
  mReadConfigSeeds.mockReturnValue({ sync: '111', map: '222' });
  mUpdateConfigSeeds.mockImplementation(() => 'UPDATED');
  mFindProcess.mockResolvedValue(null);
  mIsRunning.mockResolvedValue(true);
  mKillProcess.mockResolvedValue(undefined);
});

describe('VoxCivilization (mock tier)', () => {
  describe('seed save -> restore round-trip', () => {
    it('captures the original seeds, writes new ones, then restores the captured values', async () => {
      mReadConfigSeeds.mockReturnValue({ sync: '777', map: '888', lastCiv: '29' });
      const civ = new VoxCivilization();

      // Save: applyLaunchSettings reads config.ini, captures original, writes new.
      await civ.applyLaunchSettings({ sync: 5, map: 9 });

      expect(mGetUserFilePath).toHaveBeenCalledWith('config.ini');
      // Original values were read before overwriting.
      expect(mReadConfigSeeds).toHaveBeenCalledWith('[CONFIG]\n');
      // New seeds written as numbers, and the human slot's civ set to random.
      expect(mUpdateConfigSeeds).toHaveBeenCalledWith('[CONFIG]\n', { sync: 5, map: 9, lastCiv: -1 });
      expect(mWriteFile).toHaveBeenCalledWith(CONFIG_PATH, 'UPDATED', 'utf-8');

      mUpdateConfigSeeds.mockClear();
      mWriteFile.mockClear();

      // Restore: the captured original seed strings and LastCiv are written back.
      await civ.restoreLaunchSettings();

      expect(mUpdateConfigSeeds).toHaveBeenCalledWith('[CONFIG]\n', { sync: '777', map: '888', lastCiv: '29' });
      expect(mWriteFile).toHaveBeenCalledWith(CONFIG_PATH, 'UPDATED', 'utf-8');
    });

    it('defaults omitted seeds to 0 on save and defaults missing captured values to "0"', async () => {
      mReadConfigSeeds.mockReturnValue({}); // config had neither side set
      const civ = new VoxCivilization();

      await civ.applyLaunchSettings(); // no seeds provided

      // An unseeded run leaves LastCiv alone.
      const written = mUpdateConfigSeeds.mock.calls[0][1];
      expect(written).toMatchObject({ sync: 0, map: 0 });
      expect(written.lastCiv).toBeUndefined();

      mUpdateConfigSeeds.mockClear();
      await civ.restoreLaunchSettings();

      // Captured fallbacks were '0'/'0'.
      expect(mUpdateConfigSeeds).toHaveBeenCalledWith('[CONFIG]\n', { sync: '0', map: '0' });
    });

    it('restoreLaunchSettings is a no-op when no seeds were ever applied', async () => {
      const civ = new VoxCivilization();

      await civ.restoreLaunchSettings();

      expect(mUpdateConfigSeeds).not.toHaveBeenCalled();
      expect(mWriteFile).not.toHaveBeenCalled();
    });

    it('only captures the original once across repeated applyLaunchSettings calls', async () => {
      mReadConfigSeeds
        .mockReturnValueOnce({ sync: 'orig', map: 'origmap' })
        .mockReturnValue({ sync: '999', map: '999' });
      const civ = new VoxCivilization();

      await civ.applyLaunchSettings({ sync: 1, map: 1 });
      await civ.applyLaunchSettings({ sync: 2, map: 2 });

      mUpdateConfigSeeds.mockClear();
      await civ.restoreLaunchSettings();

      // Restores the FIRST captured original, not the second read.
      expect(mUpdateConfigSeeds).toHaveBeenCalledWith('[CONFIG]\n', { sync: 'orig', map: 'origmap' });
    });
  });

  describe('missing config.ini (Civ V never started)', () => {
    it('skips an unseeded run without throwing or writing', async () => {
      mReadFile.mockRejectedValue(new Error('ENOENT'));
      const civ = new VoxCivilization();

      await expect(civ.applyLaunchSettings()).resolves.toBeUndefined();
      await civ.restoreLaunchSettings();

      expect(mWriteFile).not.toHaveBeenCalled();
      expect(mMkdir).not.toHaveBeenCalled();
    });

    it('creates config.ini for a seeded run and restores zeros afterwards', async () => {
      mReadFile.mockRejectedValue(new Error('ENOENT'));
      mReadConfigSeeds.mockReturnValue({});
      const civ = new VoxCivilization();

      await civ.applyLaunchSettings({ sync: 5, map: 9 });

      expect(mMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(mUpdateConfigSeeds).toHaveBeenCalledWith('', { sync: 5, map: 9, lastCiv: -1 });
      expect(mWriteFile).toHaveBeenCalledWith(CONFIG_PATH, 'UPDATED', 'utf-8');

      // Restore reads the file back, which exists by now.
      mReadFile.mockResolvedValue('[CONFIG]\n');
      mUpdateConfigSeeds.mockClear();
      await civ.restoreLaunchSettings();

      expect(mUpdateConfigSeeds).toHaveBeenCalledWith('[CONFIG]\n', { sync: '0', map: '0' });
    });
  });

  describe('bind-to-existing-process', () => {
    it('binds to a discovered PID without spawning when a process already exists', async () => {
      mFindProcess.mockResolvedValue(31337);
      const civ = new VoxCivilization();

      const started = await civ.startGame('LoadMods.lua');

      expect(started).toBe(true);
      expect(mFindProcess).toHaveBeenCalledWith('CivilizationV_DX11.exe');
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

    it('forgets the tracked process on destroy()', async () => {
      mFindProcess.mockResolvedValue(31338);
      const civ = new VoxCivilization();
      await civ.startGame('LoadMods.lua');

      civ.destroy();

      expect(civ.isGameRunning()).toBe(false);
      expect(civ.getProcessId()).toBe(null);
    });

    it('launches a new game after destroy() when the old process is gone', async () => {
      mFindProcess.mockResolvedValueOnce(31339);
      const civ = new VoxCivilization();
      await civ.startGame('LoadMods.lua');
      civ.destroy();

      // The player closed Civ V by hand, so tasklist finds nothing until the relaunch.
      const child = new FakeChild();
      mSpawn.mockReturnValue(child as never);
      mFindProcess.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(4040);

      const started = await civ.startGame('LoadMods.lua');

      expect(started).toBe(true);
      expect(mSpawn).toHaveBeenCalledTimes(1);
      expect(civ.getProcessId()).toBe(4040);

      civ.destroy();
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

  describe('launch environment forwarding', () => {
    afterEach(() => {
      delete process.env.VOX_RL_CAPTURE;
      delete process.env.VOX_TEST_SECRET;
    });

    it('carries VOX_RL_CAPTURE into the launch script child and drops the rest of our env', async () => {
      process.env.VOX_RL_CAPTURE = '1';
      // Stand-in for the secrets our environment can carry (API keys and friends).
      process.env.VOX_TEST_SECRET = 'do-not-leak';
      // The pre-launch round finds no running game under either image name.
      // The first launch poll finds the direct child without requiring the
      // launcher script to exit.
      mFindProcess.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(1212);

      const child = new FakeChild();
      mSpawn.mockReturnValue(child as never);

      const civ = new VoxCivilization();
      const promise = civ.startGame('StartGame.lua');

      const started = await promise;

      expect(started).toBe(true);
      const options = mSpawn.mock.calls[0][2];
      // The capture opt-in rides along with the Windows system baseline...
      expect(options?.env?.VOX_RL_CAPTURE).toBe('1');
      expect(options?.env?.SystemRoot).toBe(process.env.SystemRoot);
      // ...and nothing else from our environment does.
      expect(options?.env?.VOX_TEST_SECRET).toBeUndefined();
      const allowed = ['COMSPEC', 'PATHEXT', 'PATH', 'SystemDrive', 'SystemRoot', 'TEMP', 'TMP', 'windir', 'VOX_RL_CAPTURE', 'VOX_RL_CAPTURE_TIMINGS'];
      expect(Object.keys(options?.env ?? {}).every((key) => allowed.includes(key))).toBe(true);

      civ.destroy();
    });
  });

  describe('map script override', () => {
    const savedMap = String.raw`C:\Mods\(5) Vox Deorum\Maps\Saved.lua`;
    let civ: VoxCivilization;
    let configText: string;

    /** Read the map script selection currently stored in the fake config.ini. */
    const savedSelection = () => readCivConfigMapScriptContent(configText);

    beforeEach(() => {
      civ = new VoxCivilization();
      configText = `[UserSettings]\nLastMapScript = ${savedMap}\nLastMapScriptRandom = 1\n`;
      mFindProcess.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(1234);
      mSpawn.mockReturnValue(new FakeChild() as never);
      // Keep config.ini in memory so writes can be read back; templates are irrelevant here.
      mReadFile.mockImplementation(async file => String(file) === CONFIG_PATH ? configText : '');
      mWriteFile.mockImplementation(async (file, data) => {
        if (String(file) === CONFIG_PATH) configText = String(data);
      });
      mUpdateConfigSeeds.mockImplementation(content => content);
    });

    afterEach(() => civ.destroy());

    it('should select the override for a new game and restore the saved selection afterwards', async () => {
      const override = String.raw`Assets\Maps\Continents.lua`;

      await expect(civ.startGame('StartGame.lua', 4, false, undefined, override)).resolves.toBe(true);
      expect(savedSelection()).toEqual({ script: override, random: '0' });

      await civ.restoreLaunchSettings();
      expect(savedSelection()).toEqual({ script: savedMap, random: '1' });
    });

    it('should restore the original selection after a relaunch re-applies the override', async () => {
      await civ.applyLaunchSettings(undefined, 'first.lua');
      await civ.applyLaunchSettings(undefined, 'first.lua');

      await civ.restoreLaunchSettings();
      expect(savedSelection()).toEqual({ script: savedMap, random: '1' });
    });

    it('should remove map keys on restore that config.ini did not have', async () => {
      configText = '[CONFIG]\nSyncRandSeed = 0\n';

      await civ.applyLaunchSettings(undefined, 'override.lua');
      await civ.restoreLaunchSettings();

      expect(savedSelection()).toEqual({});
    });

    it('should create config.ini for an override when Civ V never started', async () => {
      mReadFile.mockRejectedValueOnce(new Error('ENOENT'));

      await civ.applyLaunchSettings(undefined, 'override.lua');

      expect(mMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(savedSelection()).toEqual({ script: 'override.lua', random: '0' });
    });

    it.each([undefined, ''])('should keep the saved selection when the override is %j', async mapScript => {
      await civ.startGame('StartGame.lua', 4, false, undefined, mapScript);
      await civ.restoreLaunchSettings();

      expect(savedSelection()).toEqual({ script: savedMap, random: '1' });
    });

    it.each(['LoadGame.lua', 'LoadMods.lua'])('should ignore the override in %s mode', async luaName => {
      await expect(civ.startGame(luaName, undefined, false, undefined, 'override.lua')).resolves.toBe(true);

      expect(mWriteFile).not.toHaveBeenCalledWith(CONFIG_PATH, expect.anything(), expect.anything());
    });

    it('should leave a running game untouched when an override is supplied', async () => {
      mFindProcess.mockReset().mockResolvedValue(9876);

      await expect(civ.startGame('StartGame.lua', 4, false, undefined, 'override.lua')).resolves.toBe(true);

      expect(mSpawn).not.toHaveBeenCalled();
      expect(mWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('DirectX 11 build selection', () => {
    it('asks the launcher for the DirectX 11 build by default', async () => {
      mFindProcess.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(7001);
      const child = new FakeChild();
      mSpawn.mockReturnValue(child as never);
      const civ = new VoxCivilization();

      await expect(civ.startGame('LoadMods.lua')).resolves.toBe(true);

      const args = mSpawn.mock.calls[0][1] as string[];
      // Positional order: lua script, production mode, executable.
      expect(args[args.length - 1]).toBe('CivilizationV_DX11.exe');
      expect(args[args.length - 2]).toBe('standard');
      expect(civ.getGameExecutable()).toBe('CivilizationV_DX11.exe');

      civ.destroy();
    });

    it('keeps the production token in place when visual mode is on', async () => {
      mFindProcess.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(7002);
      const child = new FakeChild();
      mSpawn.mockReturnValue(child as never);
      const civ = new VoxCivilization();

      await civ.startGame('LoadMods.lua', undefined, true);

      const args = mSpawn.mock.calls[0][1] as string[];
      expect(args[args.length - 2]).toBe('production');
      expect(args[args.length - 1]).toBe('CivilizationV_DX11.exe');

      civ.destroy();
    });

    it('asks for the default build and searches only that name when DX11 is off', async () => {
      mFindProcess.mockResolvedValueOnce(null).mockResolvedValue(7003);
      const child = new FakeChild();
      mSpawn.mockReturnValue(child as never);
      const civ = new VoxCivilization();
      civ.setUseDX11(false);

      await expect(civ.startGame('LoadMods.lua')).resolves.toBe(true);

      expect(mFindProcess).toHaveBeenCalledWith('CivilizationV.exe');
      expect(mFindProcess).not.toHaveBeenCalledWith('CivilizationV_DX11.exe');
      const args = mSpawn.mock.calls[0][1] as string[];
      expect(args[args.length - 1]).toBe('CivilizationV.exe');

      civ.destroy();
    });

    it('binds to the default build when the launcher falls back to it', async () => {
      // DX11 is requested but the install has no such binary, so the game
      // only ever shows up under the default image name.
      mFindProcess.mockImplementation(async (imageName: string) =>
        imageName === 'CivilizationV.exe' ? 8008 : null
      );
      const civ = new VoxCivilization();
      const bound: string[] = [];
      civ.onGameBound((imageName) => bound.push(imageName));

      await expect(civ.startGame('LoadMods.lua')).resolves.toBe(true);

      expect(civ.getProcessId()).toBe(8008);
      expect(civ.getGameExecutable()).toBe('CivilizationV.exe');
      expect(bound).toEqual(['CivilizationV.exe']);

      civ.destroy();
    });
  });

  describe('crash-recovery / launch-failure handling', () => {
    it('restores seeds when the launch script fails for a brand-new StartGame', async () => {
      // No existing process under either image name -> spawns the launch script.
      mFindProcess.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mReadConfigSeeds.mockReturnValue({ sync: 'origSync', map: 'origMap' });

      const child = new FakeChild();
      mSpawn.mockReturnValue(child as never);
      mFindProcess.mockImplementationOnce(async () => {
        child.emit('exit', 1);
        return null;
      });

      const civ = new VoxCivilization();
      const promise = civ.startGame('StartGame.lua');

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

    it('waits through a delayed direct launch and binds when Civilization V appears', async () => {
      // The game does not exist before the spawn, and stays invisible for the
      // first two poll rounds after it. Rounds are counted on the preferred
      // (DX11) image name, which every round checks first.
      const visibleFromRound = 3;
      let launched = false;
      let launchRounds = 0;
      const child = new FakeChild();
      mSpawn.mockImplementation(() => {
        launched = true;
        return child as never;
      });
      mFindProcess.mockImplementation(async (imageName: string) => {
        if (!launched || imageName !== 'CivilizationV_DX11.exe') return null;
        launchRounds++;
        return launchRounds >= visibleFromRound ? 4321 : null;
      });

      const civ = new VoxCivilization();

      await expect(civ.startGame('LoadMods.lua')).resolves.toBe(true);
      expect(launchRounds).toBe(visibleFromRound);
      // One sleep between each pair of poll rounds, none after the hit.
      expect(vi.mocked(sleep)).toHaveBeenCalledTimes(visibleFromRound - 1);
      expect(civ.getProcessId()).toBe(4321);
      expect(civ.getGameExecutable()).toBe('CivilizationV_DX11.exe');
      civ.destroy();
    });

    it('restores seeds when the launcher reports an error before Civilization V appears', async () => {
      mFindProcess.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mReadConfigSeeds.mockReturnValue({ sync: 'origSync', map: 'origMap' });
      const child = new FakeChild();
      mSpawn.mockReturnValue(child as never);
      mFindProcess.mockImplementationOnce(async () => {
        child.emit('error', new Error('launcher failed'));
        return null;
      });

      const civ = new VoxCivilization();
      await expect(civ.startGame('StartGame.lua')).resolves.toBe(false);
      expect(mUpdateConfigSeeds).toHaveBeenLastCalledWith('[CONFIG]\n', {
        sync: 'origSync',
        map: 'origMap',
      });
      civ.destroy();
    });

    it('fails and restores seeds when Civilization V never appears', async () => {
      mFindProcess.mockResolvedValue(null);
      mReadConfigSeeds.mockReturnValue({ sync: 'origSync', map: 'origMap' });
      const child = new FakeChild();
      mSpawn.mockReturnValue(child as never);

      const civ = new VoxCivilization();

      await expect(civ.startGame('StartGame.lua')).resolves.toBe(false);
      expect(mFindProcess).toHaveBeenCalledTimes(62);
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
