/**
 * @module infra/obs-manager
 *
 * Manages OBS Studio for recording and livestreaming game sessions.
 * Uses obs-websocket-js (WebSocket v5) to control OBS programmatically.
 *
 * Responsibilities:
 * - Connect to OBS via WebSocket
 * - Set up game capture scenes automatically
 * - Start/stop/pause/resume recording or streaming
 * - Health monitoring with automatic reconnection
 * - OBS process detection and launch
 * - Game ID–based recording directory management
 *
 * Production lifecycle is managed by ProductionController, which wraps
 * this class to add segment-based recording driven by game render events.
 */

import OBSWebSocket from 'obs-websocket-js';
import { spawn, execSync } from 'child_process';
import { setTimeout } from 'node:timers/promises';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger.js';
import { processManager } from './process-manager.js';
import type { ProductionMode, ObsConfig } from '../types/config.js';

const logger = createLogger('ObsManager');

const GAME_SCENE_NAME = 'Vox Deorum';
const PAUSE_SCENE_NAME = 'Vox Deorum - Paused';
const GAME_CAPTURE_INPUT_NAME = 'Game Capture';
const PAUSE_IMAGE_INPUT_NAME = 'Pause Image';
const GAME_AUDIO_INPUT_NAME = 'Game Audio';
const GAME_AUDIO_INPUT_KIND = 'wasapi_process_output_capture';
const GAME_EXECUTABLE = 'CivilizationV.exe';
const DEFAULT_OBS_PATH = 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe';
const HEALTH_POLL_INTERVAL = 10_000;
const MAX_BACKOFF_INTERVAL = 60_000;

class ObsManager {
  private obs = new OBSWebSocket();
  private mode: ProductionMode = 'none';
  private obsConfig?: ObsConfig;
  private connected = false;
  private productionActive = false;
  private healthTimer?: ReturnType<typeof globalThis.setTimeout>;
  private recovering = false;
  private backoffMs = HEALTH_POLL_INTERVAL;
  private processManagerRegistered = false;

  // Game ID and recording directory management
  private gameID?: string;
  private baseRecordDir?: string;
  private currentRecordDir?: string;

  /** Names of special inputs we muted — restore on destroy. */
  private mutedInputs: string[] = [];

  /**
   * Initialize OBS connection and set up scenes.
   * Returns true if OBS is operational, false if it could not connect.
   */
  async initialize(mode: ProductionMode, config?: ObsConfig): Promise<boolean> {
    if (mode !== 'livestream' && mode !== 'recording') {
      logger.debug(`OBS not needed for mode: ${mode}`);
      return false;
    }

    this.mode = mode;
    this.obsConfig = config;

    // Register with ProcessManager for clean shutdown
    if (!this.processManagerRegistered) {
      this.processManagerRegistered = true;
      processManager.register('obs', async () => {
        await this.destroy();
      });
    }

    // Ensure OBS is running
    if (!this.isObsRunning()) {
      const launched = this.launchObs();
      if (!launched) {
        logger.error('Failed to launch OBS Studio');
        return false;
      }
      // Give OBS time to start and initialize WebSocket server
      await this.sleep(3000);
    }

    // Connect to OBS WebSocket
    const wsConnected = await this.connect();
    if (!wsConnected) return false;

    // Set up scenes
    await this.setupScenes();

    // Query and cache the OBS recording directory
    this.baseRecordDir = await this.queryRecordingDirectory();
    if (this.baseRecordDir) {
      logger.info(`OBS recording directory: ${this.baseRecordDir}`);
    }

    // Start health monitoring
    this.startHealthMonitor();

    logger.info(`OBS initialized in ${mode} mode`);
    return true;
  }

  /**
   * Set the game ID for recording directory organization.
   * If not currently recording, updates the OBS recording directory immediately.
   * If recording is active, the change takes effect on the next recording.
   */
  async setGameID(gameID: string): Promise<void> {
    this.gameID = gameID;

    if (this.connected && !this.productionActive) {
      await this.updateRecordingDirectory();
    } else if (this.productionActive) {
      logger.info(`Game ID set to ${gameID} — will take effect on next recording`);
    }
  }

  /**
   * Start recording or streaming based on the current mode.
   */
  async startProduction(): Promise<void> {
    if (!this.connected) {
      logger.warn('Cannot start production: OBS not connected');
      return;
    }

    // Set up recording directory before starting
    await this.updateRecordingDirectory();

    if (this.mode === 'recording') {
      // If already recording, treat as success (idempotent)
      const status = await this.obs.call('GetRecordStatus');
      if (status.outputActive) {
        logger.info('Recording already active — joining existing session');
        this.productionActive = true;
        return;
      }

      await this.obs.call('StartRecord');
      this.productionActive = true;
      logger.info('Recording started');
    } else if (this.mode === 'livestream') {
      const status = await this.obs.call('GetStreamStatus');
      if (status.outputActive) {
        logger.info('Stream already active — joining existing session');
        this.productionActive = true;
        return;
      }

      await this.obs.call('StartStream');
      this.productionActive = true;
      logger.info('Streaming started');
    }
  }

  /**
   * Pause production.
   * - Recording mode: PauseRecord (keeps file open, no dead air)
   * - Livestream mode: Switch to pause scene (shows static image)
   */
  async pauseProduction(): Promise<void> {
    if (!this.connected || !this.productionActive) return;

    try {
      if (this.mode === 'recording') {
        await this.obs.call('PauseRecord');
        logger.info('Recording paused');
      } else if (this.mode === 'livestream') {
        await this.obs.call('SetCurrentProgramScene', { sceneName: PAUSE_SCENE_NAME });
        logger.info('Stream paused (switched to pause scene)');
      }
    } catch (error) {
      logger.error('Failed to pause production:', error);
    }
  }

  /**
   * Resume production after a pause.
   * - Recording mode: ResumeRecord
   * - Livestream mode: Switch back to game capture scene
   */
  async resumeProduction(): Promise<void> {
    if (!this.connected || !this.productionActive) return;

    try {
      if (this.mode === 'recording') {
        await this.obs.call('ResumeRecord');
        logger.info('Recording resumed');
      } else if (this.mode === 'livestream') {
        await this.obs.call('SetCurrentProgramScene', { sceneName: GAME_SCENE_NAME });
        logger.info('Stream resumed (switched to game scene)');
      }
    } catch (error) {
      logger.error('Failed to resume production:', error);
    }
  }

  /**
   * Stop production. Returns the OBS output file path for recording mode.
   */
  async stopProduction(): Promise<string | undefined> {
    if (!this.connected || !this.productionActive) return undefined;

    let outputPath: string | undefined;

    try {
      if (this.mode === 'recording') {
        const response = await this.obs.call('StopRecord');
        outputPath = response.outputPath;

        // Wait for OBS to fully finalize the recording
        for (let i = 0; i < 10; i++) {
          await this.sleep(200);
          const status = await this.obs.call('GetRecordStatus');
          if (!status.outputActive) break;
        }

        logger.info('Recording stopped');
      } else if (this.mode === 'livestream') {
        await this.obs.call('StopStream');
        logger.info('Streaming stopped');
      }
      this.productionActive = false;
    } catch (error) {
      logger.error('Failed to stop production:', error);
      this.productionActive = false;
    }

    return outputPath;
  }

  /** Whether OBS is connected and operational. */
  isOperational(): boolean {
    return this.connected;
  }

  /** Whether production (recording/streaming) is active. */
  isProductionActive(): boolean {
    return this.productionActive;
  }

  /** Get the current recording directory (gameID-scoped). */
  getRecordingDirectory(): string | undefined {
    return this.currentRecordDir;
  }

  /**
   * Cleanly disconnect and stop all OBS operations.
   */
  async destroy(): Promise<void> {
    this.stopHealthMonitor();

    if (this.productionActive) {
      try {
        await this.stopProduction();
      } catch {
        // Best-effort stop during destroy
      }
    }

    // Restore OBS recording directory to original
    if (this.connected && this.baseRecordDir && this.currentRecordDir && this.currentRecordDir !== this.baseRecordDir) {
      try {
        await this.obs.call('SetRecordDirectory' as any, { recordDirectory: this.baseRecordDir });
      } catch {
        // Best effort
      }
    }

    // Restore any audio inputs we muted
    await this.restoreMutedInputs();

    if (this.connected) {
      try {
        this.obs.removeAllListeners();
        await this.obs.disconnect();
      } catch {
        // Ignore disconnect errors during destroy
      }
      this.connected = false;
    }

    logger.info('OBS Manager destroyed');
  }

  // --- Private methods ---

  /** Connect to the OBS WebSocket server. */
  private async connect(): Promise<boolean> {
    const port = this.obsConfig?.wsPort ?? 4455;
    const password = this.obsConfig?.wsPassword;
    const url = `ws://127.0.0.1:${port}`;

    // Avoid stacking listeners across reconnects
    this.obs.removeAllListeners();

    try {
      await this.obs.connect(url, password);
      this.connected = true;
      this.backoffMs = HEALTH_POLL_INTERVAL;
      logger.info(`Connected to OBS WebSocket at ${url}`);

      // Detect disconnects immediately instead of waiting for next health poll
      this.obs.on('ConnectionClosed', () => {
        if (!this.connected) return; // already handled
        logger.warn('OBS WebSocket connection closed unexpectedly');
        this.connected = false;
        void this.attemptRecovery();
      });

      return true;
    } catch (error) {
      logger.error(`Failed to connect to OBS WebSocket at ${url}:`, error);
      this.connected = false;
      return false;
    }
  }

  /** Query OBS for the current recording output directory, stripping any
   *  trailing UUID-shaped segments we may have appended in a previous session. */
  private async queryRecordingDirectory(): Promise<string | undefined> {
    try {
      const result = await this.obs.call('GetRecordDirectory' as any);
      let dir: string | undefined = (result as any).recordDirectory;
      if (!dir) return undefined;

      // Strip trailing path segments that look like UUIDs (game IDs).
      // Prevents recursive stacking: base/game1/game2/… → base
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      while (dir && uuidRe.test(path.basename(dir))) {
        dir = path.dirname(dir);
      }

      return dir;
    } catch (error) {
      logger.warn('Failed to query OBS recording directory:', error);
      return undefined;
    }
  }

  /**
   * Update the OBS recording directory to {baseRecordDir}/{gameID}/.
   * Idempotent — skips the OBS call if the target hasn't changed.
   */
  private async updateRecordingDirectory(): Promise<void> {
    if (!this.gameID || !this.baseRecordDir) return;

    const targetDir = path.join(this.baseRecordDir, this.gameID);
    if (targetDir === this.currentRecordDir) return;

    try {
      fs.mkdirSync(targetDir, { recursive: true });
      await this.obs.call('SetRecordDirectory' as any, { recordDirectory: targetDir });
      this.currentRecordDir = targetDir;
      logger.info(`Set OBS recording directory to: ${targetDir}`);
    } catch (error) {
      logger.error('Failed to set OBS recording directory:', error);
    }
  }

  /**
   * Set up OBS scenes for game capture and pause screen.
   * Creates scenes and inputs if they don't already exist.
   */
  private async setupScenes(): Promise<void> {
    try {
      const { scenes } = await this.obs.call('GetSceneList');
      const sceneNames = scenes.map((s: any) => s.sceneName as string);

      // Create game capture scene if it doesn't exist
      if (!sceneNames.includes(GAME_SCENE_NAME)) {
        await this.obs.call('CreateScene', { sceneName: GAME_SCENE_NAME });
        logger.info(`Created scene: ${GAME_SCENE_NAME}`);

        // Add game capture input
        await this.obs.call('CreateInput', {
          sceneName: GAME_SCENE_NAME,
          inputName: GAME_CAPTURE_INPUT_NAME,
          inputKind: 'game_capture',
          inputSettings: {
            capture_mode: 'window',
            window: `${GAME_EXECUTABLE}:${GAME_EXECUTABLE}:${GAME_EXECUTABLE}`,
            priority: 2, // WINDOW_PRIORITY_EXE — match by executable name
          },
        });
        logger.info(`Created game capture input targeting ${GAME_EXECUTABLE}`);
      }

      // Ensure application audio capture exists in the game scene (idempotent)
      try {
        const { sceneItems } = await this.obs.call('GetSceneItemList', {
          sceneName: GAME_SCENE_NAME,
        });
        const hasAudioCapture = sceneItems.some(
          (item: any) => item.sourceName === GAME_AUDIO_INPUT_NAME
        );
        if (!hasAudioCapture) {
          await this.obs.call('CreateInput', {
            sceneName: GAME_SCENE_NAME,
            inputName: GAME_AUDIO_INPUT_NAME,
            inputKind: GAME_AUDIO_INPUT_KIND,
            inputSettings: {
              window: `${GAME_EXECUTABLE}:${GAME_EXECUTABLE}:${GAME_EXECUTABLE}`,
              priority: 2,
            },
          });
          logger.info(`Created application audio capture targeting ${GAME_EXECUTABLE}`);
        }
      } catch (error) {
        logger.warn('Failed to set up application audio capture:', error);
      }

      // Mute default audio sources so only game audio is captured
      await this.muteDefaultAudioSources();

      // Create pause scene if it doesn't exist (for livestream mode)
      if (this.mode === 'livestream' && !sceneNames.includes(PAUSE_SCENE_NAME)) {
        await this.obs.call('CreateScene', { sceneName: PAUSE_SCENE_NAME });
        logger.info(`Created scene: ${PAUSE_SCENE_NAME}`);

        // Add pause image if configured
        const pauseImagePath = this.obsConfig?.pauseImagePath;
        if (pauseImagePath && fs.existsSync(pauseImagePath)) {
          await this.obs.call('CreateInput', {
            sceneName: PAUSE_SCENE_NAME,
            inputName: PAUSE_IMAGE_INPUT_NAME,
            inputKind: 'image_source',
            inputSettings: {
              file: pauseImagePath,
            },
          });
          logger.info(`Created pause image input: ${pauseImagePath}`);
        }
      }

      // Set game capture scene as the active scene
      await this.obs.call('SetCurrentProgramScene', { sceneName: GAME_SCENE_NAME });
      logger.info(`Active scene set to: ${GAME_SCENE_NAME}`);
    } catch (error) {
      logger.error('Failed to set up OBS scenes:', error);
    }
  }

  /** Check if OBS is currently running. */
  private isObsRunning(): boolean {
    if (process.platform !== 'win32') return false;
    try {
      const output = execSync(
        'tasklist /FI "IMAGENAME eq obs64.exe" /FO CSV',
        { encoding: 'utf-8' }
      );
      return output.includes('obs64.exe');
    } catch {
      return false;
    }
  }

  /** Launch OBS Studio as a detached process. */
  private launchObs(): boolean {
    const executablePath = this.obsConfig?.executablePath || DEFAULT_OBS_PATH;

    if (!fs.existsSync(executablePath)) {
      logger.error(`OBS executable not found: ${executablePath}`);
      return false;
    }

    const args = ['--minimize-to-tray'];
    if (this.obsConfig?.profile) {
      args.push('--profile', this.obsConfig.profile);
    }
    if (this.obsConfig?.sceneCollection) {
      args.push('--collection', this.obsConfig.sceneCollection);
    }
    if (this.obsConfig?.scene) {
      args.push('--scene', this.obsConfig.scene);
    }

    try {
      const child = spawn(executablePath, args, {
        cwd: path.dirname(executablePath),
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      logger.info(`Launched OBS Studio: ${executablePath}`);
      return true;
    } catch (error) {
      logger.error('Failed to launch OBS:', error);
      return false;
    }
  }

  /** Start periodic health monitoring using a setTimeout chain (supports dynamic backoff). */
  private startHealthMonitor(): void {
    this.scheduleHealthCheck();
  }

  /** Schedule the next health check after the current backoff interval. */
  private scheduleHealthCheck(): void {
    if (this.healthTimer) return; // already scheduled
    this.healthTimer = globalThis.setTimeout(async () => {
      this.healthTimer = undefined;
      await this.healthCheck();
      this.scheduleHealthCheck();
    }, this.backoffMs);
  }

  /** Stop health monitoring. */
  private stopHealthMonitor(): void {
    if (this.healthTimer) {
      clearTimeout(this.healthTimer);
      this.healthTimer = undefined;
    }
  }

  /** Check OBS connection health; trigger recovery if disconnected. */
  private async healthCheck(): Promise<void> {
    if (this.connected) {
      try {
        await this.obs.call('GetVersion');
        return; // healthy
      } catch {
        logger.warn('OBS health check failed — connection lost');
        this.connected = false;
      }
    }

    // Disconnected (just detected or from a prior failure) — retry.
    // The recovering guard inside attemptRecovery() prevents overlap.
    await this.attemptRecovery();
  }

  /**
   * Attempt to recover the OBS connection.
   * Guarded by `recovering` to prevent overlapping attempts from the
   * ConnectionClosed event and the health poll firing simultaneously.
   */
  private async attemptRecovery(): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;

    try {
      logger.info(`Attempting OBS recovery (backoff: ${this.backoffMs / 1000}s)`);

      // Check if OBS process is still running
      if (!this.isObsRunning()) {
        logger.warn('OBS process not found — attempting to relaunch');
        const launched = this.launchObs();
        if (!launched) {
          logger.error('Failed to relaunch OBS');
          this.increaseBackoff();
          return;
        }
        await this.sleep(5000);
      }

      // Try to reconnect
      const reconnected = await this.connect();
      if (reconnected) {
        // Re-establish scenes (fresh OBS launch won't have them)
        await this.setupScenes();

        if (this.productionActive) {
          try {
            await this.updateRecordingDirectory();

            if (this.mode === 'recording') {
              await this.obs.call('StartRecord');
              logger.info('Recording restarted after OBS recovery');
            } else if (this.mode === 'livestream') {
              await this.obs.call('StartStream');
              logger.info('Streaming restarted after OBS recovery');
            }
          } catch (error) {
            logger.error('Failed to restart production after recovery:', error);
          }
        }

        logger.info('OBS recovery successful');
        // backoff already reset to HEALTH_POLL_INTERVAL inside connect()
      } else {
        this.increaseBackoff();
      }
    } finally {
      this.recovering = false;
    }
  }

  /** Double the health-check backoff interval, capped at MAX_BACKOFF_INTERVAL. */
  private increaseBackoff(): void {
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_INTERVAL);
    logger.warn(`OBS recovery failed — next attempt in ${this.backoffMs / 1000}s`);
  }

  /**
   * Mute default Desktop Audio and Mic/Aux inputs so only the
   * application audio capture (game audio) is recorded/streamed.
   * Tracks which inputs were actually muted for restoration on destroy().
   */
  private async muteDefaultAudioSources(): Promise<void> {
    try {
      const special = await this.obs.call('GetSpecialInputs');

      const candidates = [
        special.desktop1,
        special.desktop2,
        special.mic1,
        special.mic2,
        special.mic3,
        special.mic4,
      ].filter(name => name && name.length > 0);

      for (const inputName of candidates) {
        try {
          const { inputMuted } = await this.obs.call('GetInputMute', { inputName });
          if (!inputMuted) {
            await this.obs.call('SetInputMute', { inputName, inputMuted: true });
            this.mutedInputs.push(inputName);
            logger.debug(`Muted default audio input: ${inputName}`);
          }
        } catch {
          // Input may not exist in this OBS configuration — skip
        }
      }

      if (this.mutedInputs.length > 0) {
        logger.info(`Muted ${this.mutedInputs.length} default audio input(s) — game audio only`);
      }
    } catch (error) {
      logger.warn('Failed to mute default audio sources:', error);
    }
  }

  /**
   * Restore the mute state of any inputs we muted during setup.
   * Called during destroy() to leave OBS in its original state.
   */
  private async restoreMutedInputs(): Promise<void> {
    for (const inputName of this.mutedInputs) {
      try {
        await this.obs.call('SetInputMute', { inputName, inputMuted: false });
        logger.debug(`Unmuted audio input: ${inputName}`);
      } catch {
        // Best effort — input may no longer exist
      }
    }
    if (this.mutedInputs.length > 0) {
      logger.info(`Restored ${this.mutedInputs.length} default audio input(s)`);
    }
    this.mutedInputs = [];
  }

  private sleep(ms: number): Promise<void> {
    return setTimeout(ms);
  }
}

/** Singleton ObsManager instance. */
export const obsManager = new ObsManager();
export type { ObsManager };
