/**
 * Integration tests for ObsManager — requires a running OBS Studio instance
 * with WebSocket server enabled (default port 4455).
 *
 * Tests are skipped gracefully if OBS is not reachable.
 * Run with: npm run test:obs (the live/obs tier).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import OBSWebSocket from 'obs-websocket-js';
import { setTimeout } from 'node:timers/promises';
import config from '../../../src/utils/config.js';

// Explicit gate: the live/obs tier only runs under `npm run test:obs`, which sets
// TEST_TIER. Without it we neither probe nor connect to a real OBS, so a stray run
// (e.g. pointing vitest straight at this file) can't touch a live OBS instance.
const liveObsEnabled = process.env.TEST_TIER === 'live/obs';

// Read OBS connection settings from config (which loads dotenv)
const obsPort = config.obs?.wsPort ?? 4455;
const obsPassword = config.obs?.wsPassword;
const obsUrl = `ws://127.0.0.1:${obsPort}`;

// Probe whether OBS WebSocket is reachable before running tests (only when gated on).
let obsAvailable = false;
if (liveObsEnabled) {
  const probeObs = new OBSWebSocket();
  try {
    await probeObs.connect(obsUrl, obsPassword);
    obsAvailable = true;
    await probeObs.disconnect();
  } catch {
    // OBS not available — tests will be skipped
  }
}

// Dynamic import so the module isn't loaded when OBS is absent
// (ObsManager registers a process manager hook on import)
const obsManagerModule = obsAvailable
  ? await import('../../../src/infra/obs-manager.js')
  : undefined;

const GAME_SCENE = 'Vox Deorum';
const PAUSE_SCENE = 'Vox Deorum - Paused';
const TEST_GAME_ID = 'test-game-001';

/** Short delay to let OBS propagate state changes after commands. */
const delay = (ms: number) => setTimeout(ms);

/** Remove test scenes from OBS, ignoring errors. */
async function removeTestScenes(obs: OBSWebSocket): Promise<void> {
  try {
    const { scenes } = await obs.call('GetSceneList');
    const sceneNames = scenes.map((s: any) => s.sceneName as string);
    if (sceneNames.includes(PAUSE_SCENE)) {
      await obs.call('RemoveScene', { sceneName: PAUSE_SCENE });
    }
    // Only remove game scene if another scene exists (OBS requires at least one)
    const remaining = sceneNames.filter(n => n !== PAUSE_SCENE);
    if (sceneNames.includes(GAME_SCENE) && remaining.length > 1) {
      await obs.call('RemoveScene', { sceneName: GAME_SCENE });
    }
  } catch {
    // Best effort cleanup
  }
}

/** Stop any active recording, ignoring errors. */
async function stopAnyRecording(obs: OBSWebSocket): Promise<void> {
  try {
    const status = await obs.call('GetRecordStatus');
    if (status.outputActive) {
      if (status.outputPaused) {
        await obs.call('ResumeRecord');
        await delay(500);
      }
      await obs.call('StopRecord');
      await delay(1000);
    }
  } catch { /* not recording or can't stop */ }
}

describe.skipIf(!obsAvailable)('ObsManager (requires running OBS)', () => {
  const verifyObs = new OBSWebSocket();

  beforeAll(async () => {
    await verifyObs.connect(obsUrl, obsPassword);
    await stopAnyRecording(verifyObs);
  }, 30000);

  afterAll(async () => {
    const obsManager = obsManagerModule!.obsManager;
    if (obsManager.isProductionActive()) {
      await obsManager.stopProduction();
      await delay(1000);
    }
    await obsManager.destroy();
    await stopAnyRecording(verifyObs);
    await removeTestScenes(verifyObs);
    await verifyObs.disconnect();
  }, 30000);

  it('should initialize and connect to OBS in recording mode', async () => {
    const obsManager = obsManagerModule!.obsManager;
    const result = await obsManager.initialize('recording', { wsPort: obsPort, wsPassword: obsPassword });
    expect(result).toBe(true);
    expect(obsManager.isOperational()).toBe(true);
  }, 30000);

  it('should have created the game capture scene', async () => {
    const { scenes } = await verifyObs.call('GetSceneList');
    const sceneNames = scenes.map((s: any) => s.sceneName as string);
    expect(sceneNames).toContain(GAME_SCENE);
  });

  it('should have created an application audio capture input in the game scene', async () => {
    const { sceneItems } = await verifyObs.call('GetSceneItemList', {
      sceneName: GAME_SCENE,
    });
    const audioCapture = sceneItems.find(
      (item: any) => item.sourceName === 'Game Audio'
    );
    expect(audioCapture).toBeDefined();
  });

  it('should have muted default desktop audio sources', async () => {
    const special = await verifyObs.call('GetSpecialInputs');
    if (special.desktop1) {
      const { inputMuted } = await verifyObs.call('GetInputMute', {
        inputName: special.desktop1,
      });
      expect(inputMuted).toBe(true);
    }
  });

  it('should start and stop recording under game ID folder', async () => {
    const obsManager = obsManagerModule!.obsManager;
    await obsManager.setGameID(TEST_GAME_ID);
    await obsManager.startProduction();
    await delay(1000);

    expect(obsManager.isProductionActive()).toBe(true);
    const status = await verifyObs.call('GetRecordStatus');
    expect(status.outputActive).toBe(true);

    await delay(2000);

    await obsManager.stopProduction();
    await delay(1000);

    expect(obsManager.isProductionActive()).toBe(false);

    // Verify the recording directory is organized under the game ID folder.
    // (Per-segment recording files and the JSONL log moved to ProductionController —
    // see tests/mock/infra/production-controller.test.ts.)
    const dir = obsManager.getRecordingDirectory();
    expect(dir).toBeTruthy();
    expect(dir).toContain(TEST_GAME_ID);
  }, 30000);

  it('should pause and resume recording', async () => {
    await stopAnyRecording(verifyObs);

    const obsManager = obsManagerModule!.obsManager;
    await obsManager.startProduction();
    await delay(1000);

    await obsManager.pauseProduction();
    await delay(1000);
    const pauseStatus = await verifyObs.call('GetRecordStatus');
    expect(pauseStatus.outputPaused).toBe(true);

    await obsManager.resumeProduction();
    await delay(1000);
    const resumeStatus = await verifyObs.call('GetRecordStatus');
    expect(resumeStatus.outputPaused).toBe(false);
    expect(resumeStatus.outputActive).toBe(true);

    await obsManager.stopProduction();
    await delay(1000);
  }, 30000);

  it('should report operational status correctly', () => {
    const obsManager = obsManagerModule!.obsManager;
    expect(obsManager.isOperational()).toBe(true);
  });
});

describe.skipIf(!obsAvailable)('ObsManager livestream scene switching (requires running OBS)', () => {
  const verifyObs = new OBSWebSocket();

  beforeAll(async () => {
    await verifyObs.connect(obsUrl, obsPassword);

    // Re-initialize ObsManager in livestream mode to create both scenes properly.
    // Bare CreateScene calls don't register scenes with the OBS v31 canvas;
    // setupScenes() creates scenes with inputs which associates them correctly.
    const obsManager = obsManagerModule!.obsManager;
    await obsManager.initialize('livestream', { wsPort: obsPort, wsPassword: obsPassword });
  }, 30000);

  afterAll(async () => {
    const obsManager = obsManagerModule!.obsManager;
    await obsManager.destroy();
    await removeTestScenes(verifyObs);
    await verifyObs.disconnect();
  }, 30000);

  it('should have both game and pause scenes', async () => {
    const { scenes } = await verifyObs.call('GetSceneList');
    const sceneNames = scenes.map((s: any) => s.sceneName as string);
    expect(sceneNames).toContain(GAME_SCENE);
    expect(sceneNames).toContain(PAUSE_SCENE);
  });

  it('should switch to pause scene and back via pauseProduction/resumeProduction', async () => {
    const obsManager = obsManagerModule!.obsManager;
    await obsManager.startProduction();

    const beforePause = await verifyObs.call('GetCurrentProgramScene');
    expect(beforePause.currentProgramSceneName).toBe(GAME_SCENE);

    await obsManager.pauseProduction();
    const duringPause = await verifyObs.call('GetCurrentProgramScene');
    expect(duringPause.currentProgramSceneName).toBe(PAUSE_SCENE);

    await obsManager.resumeProduction();
    const afterResume = await verifyObs.call('GetCurrentProgramScene');
    expect(afterResume.currentProgramSceneName).toBe(GAME_SCENE);

    await obsManager.stopProduction();
  });
});
