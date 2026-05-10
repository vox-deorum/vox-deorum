/**
 * Integration tests for ObsManager — requires a running OBS Studio instance
 * with WebSocket server enabled (default port 4455).
 *
 * Tests are skipped gracefully if OBS is not reachable.
 * Run with: npm run test:game (alongside other infrastructure tests)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import OBSWebSocket from 'obs-websocket-js';
import { setTimeout } from 'node:timers/promises';
import config from '../../src/utils/config.js';

// Read OBS connection settings from config (which loads dotenv)
const obsPort = config.obs?.wsPort ?? 4455;
const obsPassword = config.obs?.wsPassword;
const obsUrl = `ws://127.0.0.1:${obsPort}`;

// Probe whether OBS WebSocket is reachable before running tests
let obsAvailable = false;
const probeObs = new OBSWebSocket();
try {
  await probeObs.connect(obsUrl, obsPassword);
  obsAvailable = true;
  await probeObs.disconnect();
} catch {
  // OBS not available — tests will be skipped
}

// Dynamic import so the module isn't loaded when OBS is absent
// (ObsManager registers a process manager hook on import)
const obsManagerModule = obsAvailable
  ? await import('../../src/infra/obs-manager.js')
  : undefined;

const GAME_SCENE = 'Vox Deorum';
const PAUSE_SCENE = 'Vox Deorum - Paused';
const TEST_GAME_ID = 'test-game-001';

/** Short delay to let OBS propagate state changes after commands. */
const delay = (ms: number) => setTimeout(ms);

/** Parse a JSONL file into an array of objects. */
function parseJsonl(content: string): any[] {
  return content.trim().split('\n').map(line => JSON.parse(line));
}

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
    const result = await obsManager.initialize('recording', { wsPort: obsPort, wsPassword: obsPassword }, 'test-config');
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

    // Verify recording files were tracked
    const files = obsManager.getRecordingFiles();
    expect(files.length).toBeGreaterThan(0);

    const lastFile = files[files.length - 1];
    expect(lastFile.path).toBeTruthy();
    expect(lastFile.startedAt).toBeInstanceOf(Date);
    expect(lastFile.stoppedAt).toBeInstanceOf(Date);
    expect(lastFile.logPath).toMatch(/events\.jsonl$/);

    // Verify recording was saved under game ID folder
    expect(lastFile.path).toContain(TEST_GAME_ID);
  }, 30000);

  it('should write live JSONL event log alongside recording', async () => {
    const obsManager = obsManagerModule!.obsManager;
    const files = obsManager.getRecordingFiles();
    expect(files.length).toBeGreaterThan(0);

    const lastFile = files[files.length - 1];
    const { default: fs } = await import('fs');
    expect(fs.existsSync(lastFile.logPath)).toBe(true);

    const lines = parseJsonl(fs.readFileSync(lastFile.logPath, 'utf-8'));
    expect(lines.length).toBeGreaterThan(0);

    // First line should be session_start header
    const header = lines[0];
    expect(header.type).toBe('session_start');
    expect(header.configName).toBe('test-config');
    expect(header.productionMode).toBe('recording');
    expect(header.gameID).toBe(TEST_GAME_ID);
    expect(typeof header.at).toBe('number');

    // All events should have numeric timestamps
    for (const line of lines) {
      expect(typeof line.at).toBe('number');
    }

    const eventTypes = lines.map((e: any) => e.type);
    expect(eventTypes).toContain('recording_started');
    expect(eventTypes).toContain('recording_stopped');
    expect(eventTypes).toContain('recording_file');

    // recording_file event should have the video filename (basename only)
    const fileEvent = lines.find((e: any) => e.type === 'recording_file');
    expect(fileEvent.details).toBeTruthy();
    expect(fileEvent.details).not.toContain('\\');
    expect(fileEvent.details).not.toContain('/');
  });

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

  it('should not throw when addEvent is called without open log', () => {
    const obsManager = obsManagerModule!.obsManager;
    expect(() => obsManager.addEvent('test_event', 'test details')).not.toThrow();
    expect(() => obsManager.addEvent('another_event')).not.toThrow();
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
    await obsManager.initialize('livestream', { wsPort: obsPort, wsPassword: obsPassword }, 'test-config');
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
