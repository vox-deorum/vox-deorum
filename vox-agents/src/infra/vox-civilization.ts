/**
 * @module infra/vox-civilization
 *
 * Manages Civilization V game process lifecycle.
 * Handles game launching, process monitoring, and exit callback management
 * for the Windows environment. Supports binding to existing processes and
 * crash recovery scenarios.
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { setTimeout } from 'node:timers/promises'
import { readFile, writeFile } from 'fs/promises';
import { createLogger } from '../utils/logger.js';
import type { RandomSeedsConfig } from '../types/config.js';
import {
  readCivConfigSeedsContent,
  updateCivConfigSeedsContent,
  updateCivUserSettingsSkipAnimationsContent
} from '../utils/game/civ5-ini.js';
import { getCiv5UserFilePath } from '../utils/game/civ5-user-files.js';
import { hasRandomSeeds } from '../utils/game/random-seeds.js';
import {
  findProcessByImageName,
  isProcessRunning as isWindowsProcessRunning,
  killProcess
} from '../utils/game/windows-process.js';

const logger = createLogger('VoxCivilization');
type ExitCallback = (code: number | null) => void;

interface SeedRestoreState {
  path: string;
  sync: string;
  map: string;
}


/**
 * Controls Civilization V game instance.
 * Manages game process lifecycle including launching, monitoring, and shutdown.
 *
 * @class
 *
 * @example
 * ```typescript
 * import { voxCivilization } from './infra/vox-civilization.js';
 *
 * voxCivilization.onGameExit((code) => {
 *   console.log(`Game exited with code: ${code}`);
 * });
 *
 * await voxCivilization.startGame('StartGame.lua');
 * ```
 */
export class VoxCivilization {
  private exitCallbacks: Set<ExitCallback> = new Set();
  private monitoring = false;
  private externalProcessPid: number | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private aiObserverEnabled = false;
  // Previous config.ini seed values are captured so each launch can restore the
  // user's normal Civ behavior after the game has read the startup settings.
  private seedRestoreState?: SeedRestoreState;

  /**
   * Finds and binds to an existing CivilizationV.exe process.
   *
   * @private
   * @returns True if found and bound successfully, false otherwise
   */
  private async bindToExistingProcess(): Promise<boolean> {
    const pid = await findProcessByImageName('CivilizationV.exe');
    if (pid) {
      logger.info(`Found existing CivilizationV.exe process (PID: ${pid})`);
      this.externalProcessPid = pid;
      this.monitoring = true;
      this.startProcessMonitoring();
      return true;
    } else {
      return false;
    }
  }

  /**
   * Starts polling to monitor an external process.
   * Checks every 5 seconds if the process is still running.
   *
   * @private
   */
  private startProcessMonitoring(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    // Poll every 5 seconds to check if process still exists
    this.pollInterval = setInterval(async () => {
      if (this.externalProcessPid) {
        const stillRunning = await isWindowsProcessRunning(this.externalProcessPid);
        if (!stillRunning) {
          logger.info(`Process ${this.externalProcessPid} is no longer running`);
          this.handleGameExit(0);
          this.stopProcessMonitoring();
        }
      }
    }, 5000);
  }

  /**
   * Stops the process monitoring poll
   */
  private stopProcessMonitoring(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Calculates the appropriate world size based on player count.
   * Maps player counts to Civ5 world sizes (Duel to Huge).
   *
   * @private
   * @param playerCount - Number of players
   * @returns World size index (0=Duel, 1=Tiny, 2=Small, 3=Standard, 4=Large, 5=Huge)
   */
  private calculateWorldSize(playerCount: number): number {
    if (playerCount <= 2) return 0; // Duel
    if (playerCount <= 4) return 1; // Tiny
    if (playerCount <= 6) return 2; // Small
    if (playerCount <= 8) return 3; // Standard
    if (playerCount <= 10) return 4; // Large
    return 5; // Huge (12+ players)
  }

  /**
   * Builds a Lua table literal string for required mods,
   * conditionally including AI Observer based on aiObserverEnabled.
   */
  private buildRequiredModsLua(): string {
    const mods: Record<string, string> = {
      'd1b6328c-ff44-4b0d-aad7-c657f83610cd': 'Community Patch',
      '8411a7a8-dad3-4622-a18e-fcc18324c799': 'Vox Populi',
      '24923240-e4fb-4bf6-8f0e-6e5b6cf4d3c2': 'Vox Populi + EUI',
      '04c67ca5-d408-4b9e-be1b-bbc00e67fd8e': 'Vox Deorum',
    };
    if (this.aiObserverEnabled) {
      mods['970aae10-1004-4c8a-af2d-8d601de5ec02'] = 'AI Observer (JFD)';
    }
    const entries = Object.entries(mods)
      .map(([id, name]) => `  ["${id}"] = "${name}"`)
      .join(',\n');
    return `{\n${entries}\n}`;
  }

  /**
   * Generates a Lua file from a template by replacing placeholders.
   *
   * @private
   * @param templateName - Template filename in scripts/
   * @param outputName - Output filename in scripts/
   * @param replacements - Map of placeholder keys to values (keys without {{ }})
   */
  private async generateFromTemplate(
    templateName: string,
    outputName: string,
    replacements: Record<string, string>
  ): Promise<void> {
    const templatePath = join('scripts', templateName);
    const outputPath = join('scripts', outputName);

    try {
      let content = await readFile(templatePath, 'utf-8');
      for (const [key, value] of Object.entries(replacements)) {
        content = content.replace(`{{${key}}}`, value);
      }
      await writeFile(outputPath, content, 'utf-8');
      logger.debug(`Generated ${outputPath} from ${templateName}`);
    } catch (error) {
      logger.error(`Failed to generate ${outputName} from ${templateName}:`, error);
      throw error;
    }
  }

  /**
   * Generates a StartGame.lua file from the template with dynamic player count and map size.
   *
   * @private
   * @param playerCount - Number of players to configure
   */
  private async generateStartGameLua(playerCount: number): Promise<void> {
    // Round player count to nearest even number
    const roundedPlayerCount = Math.ceil(playerCount / 2) * 2;

    // Calculate appropriate world size
    const worldSize = this.calculateWorldSize(roundedPlayerCount);

    // Generate player slots array (all AI = 2)
    const playerSlots = Array(roundedPlayerCount).fill(2).join(', ');

    logger.info(`Generating StartGame.lua for ${roundedPlayerCount} players (requested: ${playerCount}) with world size ${worldSize}`);

    await this.generateFromTemplate('StartGame.template.lua', 'StartGame.temp.lua', {
      WORLD_SIZE: worldSize.toString(),
      PLAYER_SLOTS: `{ ${playerSlots} }`,
      REQUIRED_MODS: this.buildRequiredModsLua(),
    });
  }

  /**
   * Updates SinglePlayerQuickCombatEnabled and SinglePlayerQuickMovementEnabled in
   * the user's Civ5 UserSettings.ini.
   *
   * @param skipEnabled - true enables quick-skip (value 1); false disables it (value 0)
   */
  async updateSkipAnimations(skipEnabled: boolean): Promise<void> {
    const value = skipEnabled ? '1' : '0';
    const settingsPath = await getCiv5UserFilePath('UserSettings.ini');
    let content: string;
    try {
      content = await readFile(settingsPath, 'utf-8');
    } catch {
      logger.warn(`UserSettings.ini not found at ${settingsPath}, skipping animation config`);
      return;
    }

    const updated = updateCivUserSettingsSkipAnimationsContent(content, skipEnabled);

    await writeFile(settingsPath, updated, 'utf-8');
    logger.info(`Set SinglePlayerQuickCombat/Movement to ${value} in UserSettings.ini`);
  }

  /**
   * Write requested random seeds into Civ's config.ini before launching a game.
   *
   * Civ reads `SyncRandSeed` and `MapRandSeed` during pregame initialization.
   * If one side is omitted, we write `0` for that side, preserving Civ's own
   * "pick a random/default seed" behavior while fixing the requested side.
   */
  async applyRandomSeeds(seeds?: RandomSeedsConfig): Promise<void> {
    if (!hasRandomSeeds(seeds)) return;

    const configPath = await getCiv5UserFilePath('config.ini');
    let content: string;
    try {
      content = await readFile(configPath, 'utf-8');
    } catch {
      throw new Error(`config.ini not found at ${configPath}`);
    }

    const original = readCivConfigSeedsContent(content);
    if (!this.seedRestoreState) {
      this.seedRestoreState = {
        path: configPath,
        sync: original.sync ?? '0',
        map: original.map ?? '0'
      };
    }

    const updated = updateCivConfigSeedsContent(content, {
      sync: seeds?.sync ?? 0,
      map: seeds?.map ?? 0
    });
    await writeFile(configPath, updated, 'utf-8');
    logger.info(`Set Civ V random seeds in config.ini (sync=${seeds?.sync ?? 0}, map=${seeds?.map ?? 0})`);
  }

  /**
   * Restore config.ini seed values captured before `applyRandomSeeds`.
   *
   * Restoration happens after Civ has launched/read config.ini, so repeated Vox
   * runs can be reproducible without permanently changing the user's Civ setup.
   */
  async restoreRandomSeeds(): Promise<void> {
    if (!this.seedRestoreState) return;

    const restoreState = this.seedRestoreState;
    this.seedRestoreState = undefined;

    try {
      const content = await readFile(restoreState.path, 'utf-8');
      const restored = updateCivConfigSeedsContent(content, {
        sync: restoreState.sync,
        map: restoreState.map
      });
      await writeFile(restoreState.path, restored, 'utf-8');
      logger.info('Restored Civ V random seeds in config.ini');
    } catch (error) {
      logger.warn('Failed to restore Civ V random seeds in config.ini:', error);
    }
  }

  /**
   * Enables or disables AI Observer mod inclusion in generated automation scripts.
   *
   * @param enabled - When true, the AI Observer mod is included in the required mods list
   */
  setAiObserver(enabled: boolean): void {
    this.aiObserverEnabled = enabled;
    logger.debug(`AI Observer ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Starts a Civilization V game with the specified Lua script.
   * Waits for the game process to fully initialize before returning.
   *
   * @param luaName - Name of the Lua script to run (default: 'LoadMods.lua')
   * @param playerCount - Optional number of players for StartGame.lua (generates from template)
   * @returns True if game started successfully, false if already running
   */
  async startGame(luaName: string = 'LoadMods.lua', playerCount?: number, visualMode?: boolean, randomSeeds?: RandomSeedsConfig): Promise<boolean> {
    // Check if game is already running
    if (await this.bindToExistingProcess() || this.isGameRunning()) {
      logger.info('Game instance already exists, monitoring it...');
      return true;
    }

    try {
      // Only a brand-new game reads pregame seeds from config.ini. Wait/load
      // modes bind to an existing setup and should not rewrite user settings.
      if (luaName === 'StartGame.lua') {
        await this.applyRandomSeeds(randomSeeds);
      }

      // Generate temp Lua scripts from templates with required mods
      let actualLuaName = luaName;
      if (luaName === 'StartGame.lua' && playerCount !== undefined) {
        await this.generateStartGameLua(playerCount);
        actualLuaName = 'StartGame.temp.lua';
      } else if (luaName === 'LoadGame.lua') {
        await this.generateFromTemplate('LoadGame.template.lua', 'LoadGame.temp.lua', {
          REQUIRED_MODS: this.buildRequiredModsLua(),
        });
        actualLuaName = 'LoadGame.temp.lua';
      } else if (luaName === 'LoadMods.lua') {
        await this.generateFromTemplate('LoadMods.template.lua', 'LoadMods.temp.lua', {
          REQUIRED_MODS: this.buildRequiredModsLua(),
        });
        actualLuaName = 'LoadMods.temp.lua';
      }

      const scriptPath = join('scripts', 'launch-civ5.cmd');

      logger.info(`Launching Civilization V with script: ${actualLuaName}${visualMode ? " in visual production mode" : ""}`);

      // Launch the cmd script and wait for it to complete
      const args = ['/c', scriptPath, actualLuaName];
      if (visualMode) args.push('production');

      await new Promise<void>((resolve, reject) => {
        const cmdProcess = spawn('cmd', args, {
          detached: false,
          stdio: 'inherit',
          shell: false
        });

        cmdProcess.on('exit', (code) => {
          if (code === 0) {
            logger.info('Launch script completed successfully');
            resolve();
          } else {
            reject(new Error(`Launch script exited with code ${code}`));
          }
        });

        cmdProcess.on('error', (err) => {
          reject(err);
        });
      });

      // Wait an additional 5s after the cmd finishes
      // Note that Civ5 would start a process, end it, and then start another one
      logger.info('Waiting 5 seconds for game to fully initialize...');
      await setTimeout(5000);

      // Find and bind to the actual CivilizationV.exe process
      return await this.bindToExistingProcess();
    } catch (error) {
      logger.error('Failed to launch game:', error);
      await this.restoreRandomSeeds();
      return false;
    }
  }

  /**
   * Registers a callback to be called when the game exits
   * @param callback Function to call when game exits
   */
  onGameExit(callback: ExitCallback): void {
    this.exitCallbacks.add(callback);
  }

  /**
   * Removes a previously registered exit callback
   * @param callback Callback to remove
   */
  offGameExit(callback: ExitCallback): void {
    this.exitCallbacks.delete(callback);
  }

  /**
   * Checks if the game is currently running
   * @returns true if game process exists and hasn't exited
   */
  isGameRunning(): boolean {
    return this.monitoring && this.externalProcessPid !== null;
  }

  /**
   * Gets the current game process PID if running
   * @returns Process ID or null if not running
   */
  getProcessId(): number | null {
    return this.externalProcessPid;
  }

  private handleGameExit(code: number | null): void {
    if (!this.monitoring) return;
    
    logger.info(`Game exited with code: ${code}`);
    this.monitoring = false;
    this.externalProcessPid = null;
    this.stopProcessMonitoring();

    // Notify all registered callbacks
    this.exitCallbacks.forEach(callback => {
      try {
        callback(code);
      } catch (error) {
        logger.error('Error in exit callback:', error);
      }
    });
  }

  /**
   * Forcefully kill the game process using Windows taskkill.
   *
   * @returns True if kill command succeeded, false otherwise
   */
  async killGame(): Promise<boolean> {
    if (!this.externalProcessPid) {
      logger.info('No game process to kill');
      return true;
    }

    try {
      logger.info(`Killing game process with PID: ${this.externalProcessPid}`);
      await killProcess(this.externalProcessPid);

      // Wait a bit for the process to terminate
      await setTimeout(5000);

      // Update internal state if haven't
      this.handleGameExit(-1);
      return true;
    } catch (error) {
      logger.error('Failed to kill game process:', error);
      return false;
    }
  }

  /**
   * Cleanup resources.
   * Stops monitoring and clears all callbacks.
   */
  destroy(): void {
    this.stopProcessMonitoring();
    this.exitCallbacks.clear();
  }
}

/**
 * Singleton VoxCivilization instance for managing the game process.
 *
 * @example
 * ```typescript
 * import { voxCivilization } from './infra/vox-civilization.js';
 * await voxCivilization.startGame('LoadGame.lua');
 * ```
 */
export const voxCivilization = new VoxCivilization();
