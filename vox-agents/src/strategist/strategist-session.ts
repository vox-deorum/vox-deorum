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
import { SeatingStateManager } from "../utils/game/seating/state.js";
import type { SeatingClaim } from "../utils/game/seating/types.js";
import { getMetadata, setMetadata } from "../utils/game/metadata.js";
import { OneShotAwaiter } from "../utils/async/one-shot-awaiter.js";

const logger = createLogger('StrategistSession');

/**
 * How long shutdown will wait for the MCP `GameArchived` notification before
 * giving up and treating the run as not-archived. MCP's own timing after a
 * `PlayerVictory` is ~15-20s (5s + saveKnowledge + 10s + archive copy); 120s
 * provides ~2 minutes of slack for large saves and slow disks, and shrinks
 * the window where a late-arriving notification gets dropped (which would
 * otherwise mark an archived game as a failure in the seating state).
 */
const ARCHIVE_WAIT_TIMEOUT_MS = 120_000;

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
  private production?: ProductionController;
  private readonly MAX_RECOVERY_ATTEMPTS = 3;

  /**
   * Single owner of seeding + seed-cycle state, always constructed. In the
   * trivial case (no `randomizeSeating` and a single seed set) it produces an
   * in-memory identity claim without touching the filesystem; otherwise it
   * runs the full persistent cycle.
   */
  private readonly seatingManager: SeatingStateManager;
  /** The current cell claim, set by `ensureSeatingClaim` before the game launches. */
  private seatingClaim?: SeatingClaim;
  /** Tracks whether the active claim has already been released, so shutdown() doesn't double-release. */
  private claimReleased = false;
  /** Set on PlayerVictory — the session observed a win. Does NOT by itself mean "succeeded"; archival must also confirm. */
  private victoryObserved = false;
  /** Set after `archiveAwaiter.wait()` in shutdown — whether the MCP archive succeeded for this run. */
  private archived = false;
  /** Resolved by the `GameArchived` MCP notification; shutdown waits on it. One per session. */
  private archiveAwaiter = new OneShotAwaiter<boolean>();

  /**
   * Wire the session against a pre-fetched seating claim and the manager that
   * produced it (so `attachGameID` / `releaseCell` / `refreshClaim` write back
   * to the same on-disk cycle state). The repetition loop ([./loop.ts]) owns
   * the manager and the cycle progression; the session just runs the game.
   */
  constructor(config: StrategistSessionConfig, seatingManager: SeatingStateManager, seatingClaim: SeatingClaim) {
    super(config);
    this.finishPromise = new Promise((resolve) => {
      this.victoryResolve = resolve;
    });

    this.seatingManager = seatingManager;
    this.seatingClaim = seatingClaim;

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

      const playerCount = this.computePlayerCount(luaScript);
      if (playerCount !== undefined) {
        const playerIds = Object.keys(this.config.llmPlayers).map(Number);
        logger.info(`Calculated player count: ${playerCount} from player IDs: ${playerIds.join(', ')}`);
      }

      // Seating claim is supplied by the constructor — the loop fetched it
      // already so this method can launch the game immediately.
      logger.info(
        `Starting strategist session ${this.id} in ${this.config.gameMode} mode; ` +
        `seating rotation=${this.seatingClaim!.rotation} seedIndex=${this.seatingClaim!.seedIndex} ` +
        `seatingMap=${JSON.stringify(this.seatingClaim!.seatingMap)}`,
        this.config
      );

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

      // The seed set comes from the (always-present) seating claim; trivial
      // mode supplies seedSets[0] directly, cycle mode picks per cell.
      const started = await voxCivilization.startGame(luaScript, playerCount, isObsMode(this.config.production), this.seatingClaim?.seeds);
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
        // `GameArchived` is the one event we must still process during shutdown —
        // shutdown() is actively waiting on the awaiter it resolves.
        if (params.event !== "GameArchived" && this.abortController.signal.aborted) return;

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
          case "GameArchived":
            // Predicate the awaiter ourselves: only resolve when the
            // notification's gameID matches the session's current run.
            if (this.gameID && String(params.gameID ?? '') === this.gameID) {
              this.archiveAwaiter.resolve(Boolean(params.success));
            }
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
      error: this.errorMessage,
      succeeded: this.succeeded,
      archived: this.archived,
    };
  }

  /**
   * Shuts down the session gracefully — idempotent and archive-aware.
   *
   * Called from three places:
   *   - `handlePlayerVictory` (autoplay): victory observed, drive cleanup.
   *   - `handleGameExit` (max retries exceeded): crash, no archive expected.
   *   - `console.ts` post-`start()` and process-manager hooks: belt-and-braces.
   *
   * When a victory was observed (`this.victoryObserved`), shutdown blocks on
   * the MCP `GameArchived` notification (bounded by {@link
   * ARCHIVE_WAIT_TIMEOUT_MS}) so the seating release and the session's
   * {@link succeeded} flag both reflect the real archival outcome — never
   * "victory but no archive".
   */
  async shutdown(): Promise<void> {
    if (this.state === 'stopping' || this.state === 'stopped') return;
    logger.info('Shutting down strategist session...');

    const wasVictory = this.victoryObserved;
    this.onStateChange('stopping');
    this.abortController.abort();

    // Abort all active players; on victory we mark them successful so their
    // contexts flush as completed rather than aborted.
    for (const [playerID, player] of this.activePlayers.entries()) {
      logger.debug(`Aborting player ${playerID}`);
      player.abort(wasVictory);
    }
    this.activePlayers.clear();

    try {
      // For a clean autoplay victory, ask Civ to close itself first so the
      // replay/save files are written before MCP copies them into the archive.
      if (wasVictory && this.config.autoPlay) {
        await this.requestVoluntaryGameShutdown();
      } else {
        // No autoplay victory path — give in-flight player work a chance to flush
        // (callTool metadata + context.shutdown happen in VoxPlayer.execute finally).
        await setTimeout(8000);
      }

      // Block on the MCP `GameArchived` notification when we expect one. MCP
      // only emits it on `PlayerVictory`, so crashes / non-victory shutdowns
      // skip the wait.
      if (wasVictory) {
        this.archived = await this.archiveAwaiter.wait(ARCHIVE_WAIT_TIMEOUT_MS, false);
        if (this.archived) logger.info(`Game ${this.gameID} archived successfully`);
        else logger.error(`Game ${this.gameID}: victory observed but archive failed/timed out`);
      }

      await this.obsCall('stopProduction', () => this.production!.stop());
      await mcpClient.disconnect().catch((err) => {
        logger.warn(`mcpClient.disconnect failed (non-fatal): ${(err as Error).message}`);
      });

      await voxCivilization.restoreRandomSeeds().catch(() => { });
      voxCivilization.destroy();

      // Single source of truth for "did this run succeed" — the seating
      // release mirrors the session outcome (no-op when no manager configured).
      await this.releaseSeatingClaim(this.victoryObserved, this.archived);
    } finally {
      sessionRegistry.unregister(this.id);
      this.victoryResolve?.();
      this.onStateChange('stopped');
      logger.info(`Strategist session shutdown complete (succeeded=${this.succeeded})`);
    }
  }

  /**
   * Whether this session completed successfully: victory was observed AND
   * MCP archival was confirmed. Only meaningful once `state === 'stopped'`.
   */
  get succeeded(): boolean {
    return this.victoryObserved && this.archived;
  }

  /**
   * The autoplay-victory game-shutdown ritual: stop autoplay → ask Civ to
   * close → kill the process. Extracted from `handlePlayerVictory` so the
   * unified `shutdown` owns the one canonical teardown path.
   */
  private async requestVoluntaryGameShutdown(): Promise<void> {
    mcpClient.callTool("lua-executor", { Script: `Game.SetAIAutoPlay(-1);` }).catch(() => null);
    await setTimeout(5000);
    logger.info(`Requesting voluntary shutdown of the game...`);
    mcpClient.callTool("lua-executor", { Script: `Events.UserRequestClose();` }).catch(() => null);
    await setTimeout(5000);
    const killed = await voxCivilization.killGame();
    logger.info(`Sent killing signals to the game: ${killed}`);
  }

  /**
   * True when a human is driving the game (no autoplay). Gates which Lua
   * controls the session sends after a fresh launch or crash recovery.
   */
  private get isInteractiveMode(): boolean {
    return !this.config.autoPlay;
  }

  /**
   * Wrap an OBS-side call so the strategist can stay agnostic of whether OBS
   * is configured. Returns `undefined` (and logs a non-fatal warning) when
   * OBS isn't active or the underlying call throws — the session must keep
   * running regardless of recording/streaming state.
   */
  private async obsCall<T>(operation: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (!isObsMode(this.config.production)) return undefined;
    try {
      return await fn();
    } catch (error) {
      logger.warn(`OBS operation '${operation}' failed (non-fatal):`, error);
      return undefined;
    }
  }

  /**
   * Forward a per-player turn notification to the matching VoxPlayer and
   * update the session's running turn counter. Also opportunistically
   * decays the crash-recovery counter on real progress so transient hangs
   * don't permanently exhaust the recovery budget.
   */
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

  /**
   * Reconcile the session with a new game context: bind the gameID to the
   * seating cell, verify seeds, write per-game audit metadata, spin up fresh
   * VoxPlayers using the seating map, and kick off autoplay if configured.
   * Triggered by Civ's `GameSwitched` notification on first launch and after
   * every crash-recovery relaunch.
   */
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

    // Bind the gameID to the current seating-cycle attempt so operators can
    // correlate cells to archive files. Idempotent across crash-recoveries:
    // each relaunch overwrites with the new gameID. No-op in trivial mode.
    if (this.seatingClaim) {
      await this.seatingManager.attachGameID(this.seatingClaim, params.gameID);
    }

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

    // Persist the resolved seating map (and cycle coordinates, if any) into
    // the per-game telemetry metadata. The seating claim is guaranteed to
    // exist here because `ensureSeatingClaim()` ran before startGame.
    const seatingMap = this.seatingClaim!.seatingMap;
    await this.writeSeatingMetadata();

    // Create new players using the seating map
    for (const [configSlotStr, playerConfig] of Object.entries(this.config.llmPlayers)) {
      const actualPlayerID = seatingMap[configSlotStr] ?? parseInt(configSlotStr);
      const player = new VoxPlayer(actualPlayerID, playerConfig, params.gameID, params.turn);
      await player.context.registerTools();
      this.activePlayers.set(actualPlayerID, player);
      player.execute();
    }

    // `experiment` key — consumed by the archivist pipeline to group runs of
    // the same StrategistSessionConfig together for outcome analysis.
    await setMetadata("experiment", this.config.name);
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

  /**
   * The DLL re-attached after a (re)launch. Drives recovery if we were
   * in the `recovering` state, otherwise no-op — the initial connect is
   * handled by `handleGameSwitched`.
   */
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
    const seeds = this.seatingClaim?.seeds;
    if (seeds?.sync !== undefined) {
      await setMetadata("configuredSyncRandSeed", seeds.sync);
    }
    if (seeds?.map !== undefined) {
      await setMetadata("configuredMapRandSeed", seeds.map);
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
    const expected = this.seatingClaim?.seeds;
    if (expected?.sync === undefined && expected?.map === undefined) return true;

    // `syncRandSeed`/`mapRandSeed` are written by the MCP store from Civ's
    // pregame seed values before `GameSwitched` fires; they're the stable
    // reproducibility contract across runs.
    const [observedSyncText, observedMapText] = await Promise.all([
      getMetadata("syncRandSeed"),
      getMetadata("mapRandSeed")
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

  /**
   * Finalize crash recovery once the relaunched game has reconnected: flip
   * state back to `running`, resume any paused OBS production, reset model
   * identity on existing VoxPlayers so they re-send it to the fresh game,
   * and re-issue the autoplay/strategic-view Lua. No-op when not in
   * `recovering` state.
   */
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

  /**
   * Handle Civ's `PlayerVictory` notification. Records that a victory was
   * observed (the actual `succeeded` flag is gated on archive confirmation
   * inside `shutdown`). In autoplay mode this drives the whole shutdown
   * ritual; in interactive mode it just unblocks `start()` and lets the
   * caller (or process manager) drive teardown.
   */
  private async handlePlayerVictory(params: GameEventNotification): Promise<void> {
    logger.warn(`Player ${params.playerID} has won the game on turn ${params.turn}!`);

    // Mark victory observed — shutdown() decides whether this counts as a
    // success once it has the archive notification in hand.
    this.victoryObserved = true;

    if (this.config.autoPlay) {
      // Unified shutdown handles voluntary game close, archive wait, MCP
      // disconnect, seating release, and state→stopped. Idempotent, so the
      // post-`start()` shutdown call from console.ts is a no-op.
      await this.shutdown();
    } else {
      // Non-autoplay: caller (or process manager) drives the actual shutdown.
      // We just let start() return.
      logger.info(`Finishing the run...`);
      this.victoryResolve?.();
    }
  }

  /**
   * Persist the resolved seating map and cycle coordinates into the per-game
   * telemetry metadata for audit. Replaces the legacy `resolveSeatingMap`
   * write that doubled as scheduling state.
   */
  private async writeSeatingMetadata(): Promise<void> {
    const claim = this.seatingClaim;
    if (!claim) return;
    await setMetadata("seatingMap", JSON.stringify(claim.seatingMap));
    await setMetadata("seatingRotation", claim.rotation);
    await setMetadata("seatingSeedIndex", claim.seedIndex);
  }

  /**
   * Release the active claim back to the cycle exactly once. The cell only
   * becomes `completed` when both `success` (victory) and `archived` (MCP
   * archive confirmed) are true — any other combination is a retry-or-fail
   * release inside `SeatingStateManager.releaseCell`. Idempotent (the
   * `claimReleased` guard prevents double-release between the victory and
   * shutdown paths).
   */
  private async releaseSeatingClaim(success: boolean, archived: boolean): Promise<void> {
    if (!this.seatingClaim || this.claimReleased) return;
    this.claimReleased = true;
    try {
      await this.seatingManager.releaseCell(this.seatingClaim, success, archived);
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
      const actualPlayerID = this.seatingClaim?.seatingMap[configSlotStr] ?? configSlot;
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
    const playerCount = this.computePlayerCount(luaScript);

    // Game crashed unexpectedly
    logger.error(`Game process crashed with exit code: ${exitCode}`);
    await this.obsCall('suspendProduction', () => this.production!.suspend());
    this.onStateChange('error');

    // Bounded retries — shutdown() handles stopProduction internally.
    if (this.crashRecoveryAttempts >= this.MAX_RECOVERY_ATTEMPTS) {
      logger.error(`Maximum recovery attempts (${this.MAX_RECOVERY_ATTEMPTS}) exceeded. Shutting down session.`);
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
    // The active claim's seeds stay valid across the crash/recovery boundary,
    // so the recovered run stays on the same cycle cell.
    const started = await voxCivilization.startGame(luaScript, playerCount, isObsMode(this.config.production), this.seatingClaim?.seeds);

    if (!started) {
      logger.error('Failed to restart the game');
      await this.shutdown();
      return;
    }
  }

  /**
   * Derive the launch player count from the `llmPlayers` config. Returns
   * `undefined` outside the fresh-start path (LoadGame / LoadMods inherit
   * the player count from the save file). Single source of truth for the
   * calculation shared by `start()` and `handleGameExit()`.
   */
  private computePlayerCount(luaScript: string): number | undefined {
    if (this.config.gameMode !== 'start' || luaScript !== 'StartGame.lua') return undefined;
    const playerIds = Object.keys(this.config.llmPlayers).map(Number);
    if (playerIds.length === 0) return undefined;
    return Math.max(...playerIds) + 1;
  }
}
