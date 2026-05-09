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
import { StrategistSessionConfig, isVisualMode, isObsMode } from "../types/config.js";
import { obsManager } from "../infra/obs-manager.js";
import { ProductionController } from "../infra/production-controller.js";
import { config } from "../utils/config.js";
import { SessionStatus } from "../types/api.js";

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

  constructor(config: StrategistSessionConfig) {
    super(config);
    this.finishPromise = new Promise((resolve) => {
      this.victoryResolve = resolve;
    });
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

    // Register game exit handler for crash recovery
    const started = await voxCivilization.startGame(luaScript, playerCount, isObsMode(this.config.production), this.config.randomSeeds);
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

    // Resolve seating map (identity or randomized)
    this.seatingMap = await this.resolveSeatingMap();

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
   * Persist the requested seeds beside the observed seeds for auditability.
   *
   * Only explicitly fixed seeds are written. If a seed was omitted, Civ was
   * allowed to choose it and the observed `*RandSeed` metadata is enough.
   */
  private async writeConfiguredSeedMetadata(): Promise<void> {
    if (this.config.randomSeeds?.sync !== undefined) {
      await mcpClient.callTool("set-metadata", {
        Key: "configuredSyncRandSeed",
        Value: String(this.config.randomSeeds.sync)
      });
    }
    if (this.config.randomSeeds?.map !== undefined) {
      await mcpClient.callTool("set-metadata", {
        Key: "configuredMapRandSeed",
        Value: String(this.config.randomSeeds.map)
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
    const expected = this.config.randomSeeds;
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
   * Resolve the seating map for the current game.
   * When randomizeSeating is enabled, loads an existing map from the DB or generates a new permutation.
   * When disabled, returns identity mapping (config slot N -> player ID N).
   */
  private async resolveSeatingMap(): Promise<Record<string, number>> {
    const configSlots = Object.keys(this.config.llmPlayers).map(Number).sort((a, b) => a - b);

    // Without randomization, use identity mapping
    if (!this.config.randomizeSeating) {
      const identity: Record<string, number> = {};
      for (const slot of configSlots) {
        identity[String(slot)] = slot;
      }
      return identity;
    }

    // Try to load existing seating map from DB
    try {
      const result = await mcpClient.callTool("get-metadata", { Key: "seatingMap" }) as Record<string, unknown>;
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content?.[0]?.text;
      if (text) {
        const savedMap = JSON.parse(text) as Record<string, number>;
        logger.info('Loaded existing seating map from database', savedMap);
        return savedMap;
      }
    } catch {
      logger.debug('No existing seating map found, will generate new one');
    }

    // Generate new random permutation using Fisher-Yates shuffle
    const playerIDs = [...configSlots];
    for (let i = playerIDs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playerIDs[i], playerIDs[j]] = [playerIDs[j], playerIDs[i]];
    }

    const seatingMap: Record<string, number> = {};
    for (let i = 0; i < configSlots.length; i++) {
      seatingMap[String(configSlots[i])] = playerIDs[i];
    }

    // Persist to DB
    await mcpClient.callTool("set-metadata", {
      Key: "seatingMap",
      Value: JSON.stringify(seatingMap)
    });

    logger.warn('Generated and saved new seating map', seatingMap);
    return seatingMap;
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
    const started = await voxCivilization.startGame(luaScript, playerCount, isObsMode(this.config.production), this.config.randomSeeds);

    if (!started) {
      logger.error('Failed to restart the game');
      await this.shutdown();
      return;
    }
  }
}
