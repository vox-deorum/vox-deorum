/**
 * @module strategist/strategist-session
 *
 * Strategist session management.
 * Orchestrates game lifecycle, player management, crash recovery, and event handling
 * for a single game session. Manages multiple VoxPlayers and handles game state transitions.
 */

import { createLogger } from "../utils/logger.js";
import { mcpClient, type GameEventNotification } from "../utils/models/mcp-client.js";
import { VoxPlayer } from "./vox-player.js";
import { voxCivilization } from "../infra/vox-civilization.js";
import { setTimeout } from 'node:timers/promises';
import { VoxSession } from "../infra/vox-session.js";
import { sessionRegistry } from "../infra/session-registry.js";
import { StrategistSessionConfig, isVisualMode, isObsMode, RandomSeedsConfig } from "../types/config.js";
import { obsManager } from "../infra/obs-manager.js";
import { ProductionController } from "../infra/production-controller.js";
import { config } from "../utils/config.js";
import { SessionStatus } from "../types/api.js";
import { SeatingStateManager } from "../utils/game/seating/state.js";
import type { SeatingClaim } from "../utils/game/seating/types.js";
import { validateRandomSeedsList } from "../utils/game/random-seeds.js";

const logger = createLogger('StrategistSession');

/**
 * Concrete implementation of VoxSession for Strategist game sessions.
 * Manages AI players and game lifecycle.
 * Handles game startup, player coordination, crash recovery, and graceful shutdown.
 *
 * @class
 */
export class StrategistSession extends VoxSession<StrategistSessionConfig> {
  private activePlayers = new Map<number, VoxPlayer>();
  private finishPromise: Promise<void>;
  private victoryResolve?: () => void;
  private lastGameID?: string;
  private crashRecoveryAttempts = 0;
  private mcpKillCounter = 0;
  private dllConnected = false;
  private seatingMap?: Record<string, number>;
  private production?: ProductionController;
  private readonly MAX_RECOVERY_ATTEMPTS = 3;

  /** Normalized seed-set list — length M (>= 1). Drives the seedCount of the cycle. */
  private readonly seedSets: Array<RandomSeedsConfig | undefined>;
  /** Lazily constructed when the cycle is enabled (randomizeSeating or seedCount > 1). */
  private seatingManager?: SeatingStateManager;
  /** The current cell claim, if any. Refreshed on each (re-)claim during recovery. */
  private seatingClaim?: SeatingClaim;
  /** Tracks whether the active claim has already been released, so shutdown() doesn't double-release. */
  private claimReleased = false;
  /** Set on PlayerVictory so shutdown() releases the claim as success. */
  private claimSucceeded = false;

  constructor(config: StrategistSessionConfig) {
    super(config);
    this.finishPromise = new Promise((resolve) => {
      this.victoryResolve = resolve;
    });
    this.seedSets = validateRandomSeedsList(config.randomSeeds);
    voxCivilization.onGameExit(this.handleGameExit.bind(this));
  }

  /**
   * Starts the session and plays until PlayerVictory.
   * Launches the game, connects to MCP server, and waits for completion.
   */
  async start(): Promise<void> {
    try {
      // Update state to starting and register with the session registry
      this.onStateChange('starting');
      sessionRegistry.register(this);

      const luaScript = this.config.gameMode === 'start' ? 'StartGame.lua' :
                        this.config.gameMode === 'wait' ? 'LoadMods.lua' : 'LoadGame.lua';

      // Calculate player count from llmPlayers configuration
      let playerCount: number | undefined;
      if (this.config.gameMode === 'start' && luaScript === 'StartGame.lua') {
        const playerIds = Object.keys(this.config.llmPlayers).map(Number);
        if (playerIds.length > 0) {
          playerCount = Math.max(...playerIds) + 1;
          logger.info(`Calculated player count: ${playerCount} from player IDs: ${playerIds.join(', ')}`);
        }
      }

      // Claim a cell from the seating × seed cycle (no-op if neither randomizeSeating
      // nor a multi-seed array is configured). This must happen before startGame so
      // the cycle's chosen seed is what Civ launches with.
      await this.ensureSeatingClaim(playerCount);

      logger.info(`Starting strategist session ${this.id} in ${this.config.gameMode} mode`, this.config);

    // Configure animation skipping based on mode (skip in interactive mode)
    if (isVisualMode(this.config.production)) {
      await voxCivilization.updateSkipAnimations(false);   // animations play for viewers
    } else if (!this.isInteractiveMode) {
      await voxCivilization.updateSkipAnimations(true);    // skip animations in full-auto mode
    }

    // Initialize OBS for recording/livestreaming (before game launch so scenes are ready)
    const obsReady = await this.obsCall('initialize',
      () => obsManager.initialize(this.config.production!, config.obs)
    );
    if (obsReady) {
      this.production = new ProductionController(obsManager, this.config.production!);
      logger.info('OBS initialized successfully for production mode');
    } else if (isObsMode(this.config.production)) {
      logger.warn('OBS initialization failed — session will continue without recording');
    }

    // Enable AI Observer mod in non-interactive mode
    voxCivilization.setAiObserver(!this.isInteractiveMode);

    // In wait mode, prompt the user to start the game manually
    if (this.config.gameMode === 'wait') {
      logger.warn('WAIT MODE: Please manually start or load your game.');
      logger.warn('The session will automatically continue when the game is loaded.');
    }

    // The seed set is normally chosen per-cell by the seating cycle (see
    // resolveSeatingMap). For the very first launch we don't have a claim yet,
    // so use the first seed set — it will be reconciled when handleGameSwitched
    // claims the cycle's actual cell.
    const initialSeeds = this.seatingClaim?.seeds ?? this.seedSets[0];
    const started = await voxCivilization.startGame(luaScript, playerCount, isObsMode(this.config.production), initialSeeds);
    if (!started) {
      throw new Error('Failed to start Civilization V');
    }

    // Connect to MCP server
    await mcpClient.connect();

    // Set production mode on the DLL (enables AI turn cooldown for visual modes)
    await mcpClient.callTool('set-production-mode', {
      enabled: isVisualMode(this.config.production)
    });

    // Register notification handler for game events
    mcpClient.onNotification(async (params) => {
      if (this.abortController.signal.aborted) return;

      // The notification now has 'event' field instead of 'message'
      switch (params.event) {
        case "PlayerDoneTurn":
          await this.handlePlayerDoneTurn(params);
          break;
        case "GameSwitched":
          await this.handleGameSwitched(params);
          break;
        case "PlayerVictory":
          await this.handlePlayerVictory(params);
          break;
        case "DLLConnected":
          this.dllConnected = true;
          // Transition to running state when DLL connects (game is initialized)
          await this.handleDLLConnected(params);
          break;
        case "DLLDisconnected":
          this.dllConnected = false;
          // Kill the game when the game hangs
          logger.warn(`The DLL is no longer connected. Waiting for 60 seconds...`);
          await setTimeout(60000);
          if (!this.dllConnected && this.state === 'running') {
            this.onStateChange('error');
            logger.warn(`The DLL is no longer connected. Trying to restart the game...`);
            await voxCivilization.killGame();
          }
          break;
        case "PlayerPanelSwitch":
        case "AnimationStarted":
          await this.obsCall('handleRenderEvent',
            () => this.production!.handleRenderEvent(params.event, params));
          break;
        default:
          logger.info(`Received game event notification: ${params.event}`, params);
          break;
      }
    });

    const mcpKillCounter = this.mcpKillCounter;
    // Register tool error handler to kill game on critical MCP tool errors
    mcpClient.onToolError(async ({ toolName, error }) => {
      if (this.abortController.signal.aborted || mcpKillCounter !== this.mcpKillCounter) return;
      this.mcpKillCounter++;
      logger.error(`Critical MCP tool error in ${toolName}, killing game process`, error);
      await voxCivilization.killGame();
    });

      // Wait for victory, shutdown, or a fatal setup validation failure.
      await this.finishPromise;
      if (this.state === 'error') {
        throw new Error(this.errorMessage ?? 'Strategist session failed');
      }
    } catch (error) {
      logger.error('Session failed with error:', error);
      this.onStateChange('error', (error as Error).message);
      await voxCivilization.restoreRandomSeeds();
      sessionRegistry.unregister(this.id);
      throw error;
    }
  }

  /**
   * Stop the session gracefully (implements VoxSession abstract method).
   * Calls the existing shutdown() method.
   */
  async stop(): Promise<void> {
    await this.shutdown();
  }

  /**
   * Get current session status for API responses (implements VoxSession abstract method).
   */
  getStatus(): SessionStatus {
    // Get active VoxContext IDs from active players
    const contexts: string[] = [];
    for (const player of this.activePlayers.values()) {
      const contextId = player.getContextId();
      if (contextId) {
        contexts.push(contextId);
      }
    }

    return {
      id: this.id,
      type: this.config.type,
      state: this.state,
      config: this.config,
      startTime: this.startTime,
      contexts,
      gameID: this.gameID,
      turn: this.turn,
      error: this.errorMessage
    };
  }

  /**
   * Shuts down the session gracefully.
   * Aborts all players, disconnects from MCP, and cleans up resources.
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down strategist session...');

    // Update state
    this.onStateChange('stopping');

    // Signal abort to stop processing new events
    this.abortController.abort();

    // Abort all active players and wait for their contexts to shutdown
    for (const [playerID, player] of this.activePlayers.entries()) {
      logger.debug(`Aborting player ${playerID}`);
      player.abort(false);
      // Note: VoxPlayer.execute() will call context.shutdown() in its finally block
    }
    this.activePlayers.clear();

    // Wait for players to finish their cleanup (callTool metadata + context.shutdown)
    await setTimeout(8000);

    // Stop production controller (obsManager.destroy() called by ProcessManager on exit)
    await this.obsCall('stopProduction', () => this.production!.stop());

    // Disconnect from MCP server
    await mcpClient.disconnect();

    // Cleanup VoxCivilization
    await voxCivilization.restoreRandomSeeds();
    voxCivilization.destroy();

    // Release the cycle cell back to the scheduler. claimSucceeded is set by
    // handlePlayerVictory; otherwise this is a crash/abort and the cell goes
    // back to pending so it can be retried.
    await this.releaseSeatingClaim(this.claimSucceeded);

    // Resolve victory promise if still pending
    if (this.victoryResolve) {
      this.victoryResolve();
    }

    // Unregister from session registry and update state
    sessionRegistry.unregister(this.id);
    this.onStateChange('stopped');

    logger.info('Strategist session shutdown complete');
  }

  private get isInteractiveMode(): boolean {
    return !this.config.autoPlay;
  }

  private async obsCall<T>(operation: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (!isObsMode(this.config.production)) return undefined;
    try {
      return await fn();
    } catch (error) {
      logger.warn(`OBS operation '${operation}' failed (non-fatal):`, error);
      return undefined;
    }
  }

  private async handlePlayerDoneTurn(params: GameEventNotification): Promise<void> {
    await this.recoverGame();
    if (this.turn !== params.turn) {
      this.crashRecoveryAttempts = Math.max(0, this.crashRecoveryAttempts - 0.5);
    }
    const player = this.activePlayers.get(params.playerID);
    if (player) {
      player.notifyTurn(params.turn, params.latestID);
      this.turn = params.turn;  // Update current turn
    }
  }

  private async handleGameSwitched(params: GameEventNotification): Promise<void> {
    // If nothing is changing, ignore this
    if (!params.gameID || params.gameID === this.lastGameID) return;
    if (this.state === 'stopping' || this.state === 'stopped') return;
    // Stop existing production before switching game context
    await this.obsCall('stopProduction', () => this.production!.stop());

    this.lastGameID = params.gameID;
    this.gameID = params.gameID;  // Update current game ID
    this.turn = params.turn;  // Update current turn
    logger.warn(`Game context switching to ${params.gameID} at turn ${params.turn}`);

    // Set OBS game ID for recording directory organization
    await this.obsCall('setGameID', () => obsManager.setGameID(params.gameID!));
    if (this.state === 'starting') this.onStateChange('running');

    // Abort all existing players
    for (const player of this.activePlayers.values()) {
      player.abort(false);
    }
    this.activePlayers.clear();

    // The MCP store records Civ's authoritative pregame seed values before it
    // emits GameSwitched. Verify before creating players or starting autoplay so
    // a bad experiment never produces usable-looking data.
    if (!await this.verifyRandomSeeds()) return;

    await this.writeConfiguredSeedMetadata();

    // Seating map was claimed in start() (or fell back to identity). Persist it
    // (and the cycle coordinates, if any) into the per-game telemetry metadata.
    if (!this.seatingMap) {
      this.seatingMap = this.identitySeatingMap();
    }
    await this.writeSeatingMetadata();

    // Create new players using the seating map
    for (const [configSlotStr, playerConfig] of Object.entries(this.config.llmPlayers)) {
      const actualPlayerID = this.seatingMap[configSlotStr] ?? parseInt(configSlotStr);
      const player = new VoxPlayer(actualPlayerID, playerConfig, params.gameID, params.turn);
      await player.context.registerTools();
      this.activePlayers.set(actualPlayerID, player);
      player.execute();
    }

    await mcpClient.callTool("set-metadata", { Key: `experiment`, Value: this.config.name });
    await setTimeout(3000);

    if (this.config.autoPlay && params.turn === 0) {
      // Autoplay
      await mcpClient.callTool("lua-executor", {
        Script: `
Events.LoadScreenClose();
Game.SetPausePlayer(-1);
Game.SetAIAutoPlay(2000, -1);`
      });
    } else {
      await mcpClient.callTool("lua-executor", { Script: `Events.LoadScreenClose(); Game.SetPausePlayer(-1);` });
    }
    if (this.config.autoPlay && !isVisualMode(this.config.production)) {
      await setTimeout(3000);
      await mcpClient.callTool("lua-executor", { Script: `ToggleStrategicView();` });
    }

    // Start production controller (recording waits for render events)
    await this.obsCall('startProduction', () => this.production!.start());
  }

  private async handleDLLConnected(_params: GameEventNotification): Promise<void> {
    await this.recoverGame();
  }

  /**
   * The seed set the current game was launched with. Resolves through the
   * active cycle claim when the cycle is enabled; otherwise falls back to the
   * single-object form derived from `config.randomSeeds`.
   */
  private get activeSeeds(): RandomSeedsConfig | undefined {
    return this.seatingClaim?.seeds ?? this.seedSets[0];
  }

  /**
   * Persist the requested seeds beside the observed seeds for auditability.
   *
   * Only explicitly fixed seeds are written. If a seed was omitted, Civ was
   * allowed to choose it and the observed `*RandSeed` metadata is enough.
   */
  private async writeConfiguredSeedMetadata(): Promise<void> {
    const seeds = this.activeSeeds;
    if (seeds?.sync !== undefined) {
      await mcpClient.callTool("set-metadata", {
        Key: "configuredSyncRandSeed",
        Value: String(seeds.sync)
      });
    }
    if (seeds?.map !== undefined) {
      await mcpClient.callTool("set-metadata", {
        Key: "configuredMapRandSeed",
        Value: String(seeds.map)
      });
    }
  }

  /**
   * Compare configured fixed seeds with Civ's observed pregame seeds.
   *
   * This intentionally reads `syncRandSeed`/`mapRandSeed` metadata rather than
   * live RNG state. The live map/game RNGs can advance during setup, while the
   * pregame values are the stable reproducibility contract.
   */
  private async verifyRandomSeeds(): Promise<boolean> {
    const expected = this.activeSeeds;
    if (expected?.sync === undefined && expected?.map === undefined) return true;

    const [observedSyncText, observedMapText] = await Promise.all([
      this.readMetadata("syncRandSeed"),
      this.readMetadata("mapRandSeed")
    ]);
    const observedSync = Number(observedSyncText);
    const observedMap = Number(observedMapText);

    const mismatches: string[] = [];
    if (expected.sync !== undefined && observedSync !== expected.sync) {
      mismatches.push(`sync expected ${expected.sync}, observed ${observedSyncText || "(missing)"}`);
    }
    if (expected.map !== undefined && observedMap !== expected.map) {
      mismatches.push(`map expected ${expected.map}, observed ${observedMapText || "(missing)"}`);
    }

    if (mismatches.length === 0) {
      logger.info('Verified Civ V random seeds', {
        expected,
        observed: { sync: observedSyncText, map: observedMapText }
      });
      return true;
    }

    const message = `Civ V random seed verification failed: ${mismatches.join('; ')}`;
    logger.error(message);
    this.onStateChange('error', message);
    this.abortController.abort();
    await voxCivilization.killGame();
    this.victoryResolve?.();
    return false;
  }

  private async readMetadata(key: string): Promise<string> {
    const result = await mcpClient.callTool("get-metadata", { Key: key }) as Record<string, unknown>;
    const content = result.content as Array<{ type: string; text: string }> | undefined;
    return content?.[0]?.text ?? "";
  }

  private async recoverGame(): Promise<void> {
    if (this.state === 'recovering') {
      logger.warn(`Game successfully recovered from crash, resuming play... (autoplay: ${this.config.autoPlay})`);
      this.onStateChange('running');
      await this.obsCall('resumeProduction', () => this.production!.resume());
      // Reset model identity on all players so it gets re-sent to the fresh game
      for (const player of this.activePlayers.values()) {
        player.context.resetModelIdentity();
      }
      await mcpClient.callTool("lua-executor", { Script: `Events.LoadScreenClose(); Game.SetPausePlayer(-1);` });
      if (this.config.autoPlay && !isVisualMode(this.config.production)) {
        await setTimeout(3000);
        await mcpClient.callTool("lua-executor", { Script: `ToggleStrategicView();` });
      }
    }
  }

  private async handlePlayerVictory(params: GameEventNotification): Promise<void> {
    logger.warn(`Player ${params.playerID} has won the game on turn ${params.turn}!`);

    // Mark the active cycle cell as a success — shutdown() will persist this
    // when it releases the claim. We don't release here because the game still
    // needs to wind down (and the existing claim is the source of truth until
    // released, including for any further crash-recovery during shutdown).
    this.claimSucceeded = true;

    // Stop the game when autoplay
    if (this.config.autoPlay) {
      this.onStateChange('stopping');
      // Abort all existing players
      for (const player of this.activePlayers.values()) {
        player.abort(true);
      }
      this.activePlayers.clear();

      // Stop autoplay
      mcpClient.callTool("lua-executor", { Script: `Game.SetAIAutoPlay(-1);` }).catch((any) => null);
      this.onStateChange('stopping');

      // Stop the game
      await setTimeout(5000);
      logger.info(`Requesting voluntary shutdown of the game...`);
      mcpClient.callTool("lua-executor", { Script: `Events.UserRequestClose();` }).catch((any) => null);
      await setTimeout(5000);

      // Stop production before killing the game
      await this.obsCall('stopProduction', () => this.production!.stop());

      // Kill the process
      const killed = await voxCivilization.killGame();
      logger.info(`Sent killing signals to the game: ${killed}`);
      this.onStateChange('stopped');
    }

    // Resolve the victory promise to complete the session
    if (this.victoryResolve) {
      logger.info(`Finishing the run...`);
      this.victoryResolve();
    }
  }

  /**
   * Identity seating map: configSlot N → player ID N. Used when neither
   * `randomizeSeating` nor a multi-seed array is configured.
   */
  private identitySeatingMap(): Record<string, number> {
    const identity: Record<string, number> = {};
    for (const slot of Object.keys(this.config.llmPlayers).map(Number)) {
      identity[String(slot)] = slot;
    }
    return identity;
  }

  /**
   * Claim a cell from the persistent seating × seed cycle, populating
   * `this.seatingClaim` and `this.seatingMap`. No-op (identity map) when
   * neither `randomizeSeating` nor a multi-seed array is configured.
   *
   * Idempotent within a single session — safe to call again during crash
   * recovery; the manager's own-runner reclaim returns the same cell.
   *
   * @param playerCount - resolved game-slot count from `start()`. Used only when
   *   the cycle is enabled (otherwise a single virtual cell suffices).
   */
  private async ensureSeatingClaim(playerCount?: number): Promise<void> {
    const cycleEnabled = !!this.config.randomizeSeating || this.seedSets.length > 1;
    if (!cycleEnabled) {
      this.seatingMap = this.identitySeatingMap();
      return;
    }

    // For modes that don't compute playerCount (load/wait), fall back to the
    // configured slot ceiling so the cycle still has a sensible N.
    const configSlots = Object.keys(this.config.llmPlayers).map(Number);
    const totalSeats = playerCount ?? Math.max(...configSlots) + 1;

    if (!this.seatingManager) {
      this.seatingManager = new SeatingStateManager({
        configName: this.config.name,
        configSlots,
        totalSeats,
        seedCount: this.seedSets.length,
        seedSets: this.seedSets
      });
    }

    const claim = await this.seatingManager.claimNextCell();
    this.seatingClaim = claim;
    this.seatingMap = claim.seatingMap;
    this.claimReleased = false;
    this.claimSucceeded = false;

    logger.info(
      `Cycle cell claimed: rotation=${claim.rotation} seedIndex=${claim.seedIndex} ` +
      `seatingMap=${JSON.stringify(claim.seatingMap)}`
    );
  }

  /**
   * Persist the resolved seating map (and cycle coordinates, if any) into the
   * per-game telemetry metadata for audit. Replaces the legacy
   * `resolveSeatingMap` write that doubled as scheduling state.
   */
  private async writeSeatingMetadata(): Promise<void> {
    if (this.seatingMap) {
      await mcpClient.callTool("set-metadata", {
        Key: "seatingMap",
        Value: JSON.stringify(this.seatingMap)
      });
    }
    if (this.seatingClaim) {
      await mcpClient.callTool("set-metadata", {
        Key: "seatingRotation",
        Value: String(this.seatingClaim.rotation)
      });
      await mcpClient.callTool("set-metadata", {
        Key: "seatingSeedIndex",
        Value: String(this.seatingClaim.seedIndex)
      });
    }
  }

  /**
   * Release the active claim back to the cycle exactly once. `success === true`
   * marks the cell completed; `false` returns it to pending so it can be
   * retried by us or another runner. Idempotent (the `claimReleased` guard
   * prevents double-release between the victory and shutdown paths).
   */
  private async releaseSeatingClaim(success: boolean): Promise<void> {
    if (!this.seatingManager || !this.seatingClaim || this.claimReleased) return;
    this.claimReleased = true;
    try {
      await this.seatingManager.releaseCell(this.seatingClaim, success);
    } catch (err) {
      logger.warn(`Failed to release seating claim: ${(err as Error).message}`);
    }
  }

  /**
   * Get the current player assignments mapping actual player IDs to their strategist config.
   * Used by the API to expose which AI controls which player.
   */
  getPlayerAssignments(): Record<number, { strategist: string; model?: string; configSlot: number }> {
    const result: Record<number, { strategist: string; model?: string; configSlot: number }> = {};
    for (const [configSlotStr, playerConfig] of Object.entries(this.config.llmPlayers)) {
      const configSlot = parseInt(configSlotStr);
      const actualPlayerID = this.seatingMap?.[configSlotStr] ?? configSlot;
      const mainModel = playerConfig.llms?.[playerConfig.strategist];
      result[actualPlayerID] = {
        strategist: playerConfig.strategist,
        model: typeof mainModel === 'string' ? mainModel : mainModel?.name,
        configSlot
      };
    }
    return result;
  }

  /**
   * Handles game process exit events (crashes or normal exits).
   * Implements bounded crash recovery with automatic game restart.
   *
   * @private
   * @param exitCode - Exit code from the game process
   */
  private async handleGameExit(exitCode: number | null): Promise<void> {
    // Don't attempt recovery if we're shutting down or victory was achieved
    if (this.abortController.signal.aborted || this.state === 'stopping' || this.state === 'stopped') {
      logger.info('Game exited normally during shutdown or after victory');
      return;
    }

    // If the game wasn't initialized, use the appropriate script based on mode
    const luaScript = this.config.gameMode === 'start' && this.state === 'starting' ? 'StartGame.lua' :
                      this.config.gameMode === 'wait' ? 'LoadMods.lua' : 'LoadGame.lua';

    // Calculate player count for recovery (same as in start())
    let playerCount: number | undefined;
    if (this.config.gameMode === 'start' && luaScript === 'StartGame.lua') {
      const playerIds = Object.keys(this.config.llmPlayers).map(Number);
      if (playerIds.length > 0) {
        playerCount = Math.max(...playerIds) + 1;
      }
    }

    // Game crashed unexpectedly
    logger.error(`Game process crashed with exit code: ${exitCode}`);
    await this.obsCall('suspendProduction', () => this.production!.suspend());
    this.onStateChange('error');

    // Check if we've exceeded recovery attempts
    if (this.crashRecoveryAttempts >= this.MAX_RECOVERY_ATTEMPTS) {
      logger.error(`Maximum recovery attempts (${this.MAX_RECOVERY_ATTEMPTS}) exceeded. Shutting down session.`);
      await this.obsCall('stopProduction', () => this.production!.stop());
      await this.shutdown();
      return;
    }

    // Attempt to recover the game
    this.crashRecoveryAttempts++;
    logger.info(`Attempting game recovery (attempt ${Math.ceil(this.crashRecoveryAttempts)}/${this.MAX_RECOVERY_ATTEMPTS})...`);

    // Update state to recovering
    this.onStateChange('recovering');

    // Restart the game using the appropriate script to recover from crash
    if (this.config.gameMode === 'wait') {
      logger.warn('RECOVERY: Please load your game manually.');
      logger.warn('The session will automatically continue when the game is loaded.');
    } else {
      logger.info(`Starting Civilization V with ${luaScript} to recover from crash...`);
    }
    // Reuse the seeds from the active claim so the recovered run stays on the
    // same cycle cell (the claim's seed and seating map remain valid across
    // the crash/recovery boundary).
    const recoverySeeds = this.seatingClaim?.seeds ?? this.seedSets[0];
    const started = await voxCivilization.startGame(luaScript, playerCount, isObsMode(this.config.production), recoverySeeds);

    if (!started) {
      logger.error('Failed to restart the game');
      await this.shutdown();
      return;
    }
  }
}
