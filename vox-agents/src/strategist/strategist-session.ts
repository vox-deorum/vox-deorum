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
import { HumanDecisionBus, type HumanDecisionSubmission } from "./human-decision-bus.js";
import { voxCivilization } from "../infra/vox-civilization.js";
import { setTimeout } from 'node:timers/promises';
import { VoxSession } from "../infra/vox-session.js";
import { sessionRegistry } from "../infra/session-registry.js";
import { StrategistSessionConfig, isVisualMode, isObsMode, isHumanControl } from "../types/config.js";
import { obsManager } from "../infra/obs-manager.js";
import { ProductionController } from "../infra/production-controller.js";
import { config } from "../utils/config.js";
import { SessionStatus, PlayerAssignment } from "../types/api.js";
import { SeatingStateManager } from "../utils/game/seating/state.js";
import type { ObservedSeating, SeatingClaim } from "../utils/game/seating/types.js";
import { getMetadata, setMetadata } from "../utils/game/metadata.js";

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
  private production?: ProductionController;
  private readonly MAX_RECOVERY_ATTEMPTS = 3;

  /**
   * Per-session bridge between the in-game human-control panel and the waiting
   * human-strategist seat (if any). Owned here — not a module global — and
   * threaded into every VoxPlayer; only the human strategist reads it. The
   * `HumanDecision` notification resolves it; shutdown / game-switch cancel it.
   */
  private readonly humanDecisionBus = new HumanDecisionBus();

  /**
   * Single owner of seeding + seed-cycle state, always constructed. In the
   * trivial case (no `randomizeSeating` and a single seed set) it produces an
   * in-memory identity claim without touching the filesystem; otherwise it
   * runs the full persistent cycle.
   */
  private readonly seatingManager: SeatingStateManager;
  /**
   * The current cell claim. Set by the constructor for `start` mode (the loop
   * pre-fetched it via `claimNextCell`). For `load`/`wait` mode it starts
   * `undefined` and is recovered in `handleGameSwitched` by matching the
   * launched game against the cycle (see `recoverSeatingClaimFromGame`).
   */
  private seatingClaim?: SeatingClaim;
  /** Tracks whether the active claim has already been released, so shutdown() doesn't double-release. */
  private claimReleased = false;
  /** Set on PlayerVictory — the MCP server only sends this after the game archive is on disk, so it's the single "succeeded" signal. */
  private victoryObserved = false;

  /**
   * Wire the session against the manager that owns the cycle state (so
   * `attachGameID` / `releaseCell` write back to the same on-disk state) and a
   * seating claim. The claim is pre-fetched by the repetition loop
   * ([./loop.ts]) for `start` mode; for `load`/`wait` mode it is `null` and is
   * recovered from the launched game on `GameSwitched`. The loop owns the
   * manager and cycle progression; the session just runs the game.
   */
  constructor(config: StrategistSessionConfig, seatingManager: SeatingStateManager, seatingClaim: SeatingClaim | null) {
    super(config);
    this.finishPromise = new Promise((resolve) => {
      this.victoryResolve = resolve;
    });

    this.seatingManager = seatingManager;
    this.seatingClaim = seatingClaim ?? undefined;

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

      // In `start` mode the loop pre-fetched the claim so we can launch
      // immediately; in `load`/`wait` mode the cell is recovered from the
      // launched game on GameSwitched, so the claim isn't known yet.
      if (this.seatingClaim) {
        logger.info(
          `Starting strategist session ${this.id} in ${this.config.gameMode} mode; ` +
          `seating rotation=${this.seatingClaim.rotation} seedIndex=${this.seatingClaim.seedIndex} ` +
          `seatingMap=${JSON.stringify(this.seatingClaim.seatingMap)}`,
          this.config
        );
      } else {
        logger.info(
          `Starting strategist session ${this.id} in ${this.config.gameMode} mode; ` +
          `seating cell will be recovered from the launched game on GameSwitched`,
          this.config
        );
      }

      // Human-control sessions ride the existing visual-mode gating: animations
      // on, no strategic-view toggle, and the DLL AI-turn cooldown. Normalize an
      // unset/'none' production to 'test' so all of that engages from one config.
      // Explicit 'livestream'/'recording' pass through (recording a human session
      // is legitimate). See docs/plans/human-control/01-launcher.md.
      if (isHumanControl(this.config) && !isVisualMode(this.config.production)) {
        logger.warn(
          `Human-control session: normalizing production mode from '${this.config.production ?? 'none'}' to 'test' ` +
          `(animations on, normal view, no observer UI).`
        );
        this.config.production = 'test';
      }

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

      // Enable AI Observer mod in non-interactive mode, but never for human
      // control: the human watches the plain client through their civ's fog of
      // war, with no observer overlays (human-control spec §3).
      voxCivilization.setAiObserver(!this.isInteractiveMode && !isHumanControl(this.config));

      // In wait mode, prompt the user to start the game manually
      if (this.config.gameMode === 'wait') {
        logger.warn('WAIT MODE: Please manually start or load your game.');
        logger.warn('The session will automatically continue when the game is loaded.');
      }

      // The seed set comes from the (always-present) seating claim; trivial
      // mode supplies seedSets[0] directly, cycle mode picks per cell.
      const started = await voxCivilization.startGame(luaScript, playerCount, isVisualMode(this.config.production), this.seatingClaim?.seeds);
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
          case "HumanDecision":
            this.handleHumanDecision(params);
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
    };
  }

  /**
   * Shuts down the session gracefully — idempotent.
   *
   * Called from three places:
   *   - `handlePlayerVictory` (autoplay): victory observed, drive cleanup.
   *   - `handleGameExit` (max retries exceeded): crash, no archive expected.
   *   - `console.ts` post-`start()` and process-manager hooks: belt-and-braces.
   *
   * The MCP server defers `PlayerVictory` until after the game archive is on
   * disk, so by the time `victoryObserved` is set the archive has already
   * succeeded — no separate wait is needed here.
   */
  async shutdown(): Promise<void> {
    if (this.state === 'stopping' || this.state === 'stopped') return;
    logger.info('Shutting down strategist session...');

    const wasVictory = this.victoryObserved;
    this.onStateChange('stopping');
    this.abortController.abort();

    // Abort all active players; on victory we mark them successful so their
    // contexts flush as completed rather than aborted. Reject any pending
    // human-decision wait so a blocked human-strategist unwinds cleanly.
    this.humanDecisionBus.cancelAll(new Error("Session shutting down"));
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

      await this.obsCall('stopProduction', () => this.production!.stop());
      await mcpClient.disconnect().catch((err) => {
        logger.warn(`mcpClient.disconnect failed (non-fatal): ${(err as Error).message}`);
      });

      await voxCivilization.restoreRandomSeeds().catch(() => { });
      voxCivilization.destroy();

      // Single source of truth for "did this run succeed" — the seating
      // release mirrors the session outcome (no-op when no manager configured).
      await this.releaseSeatingClaim(this.victoryObserved);
    } finally {
      sessionRegistry.unregister(this.id);
      this.victoryResolve?.();
      this.onStateChange('stopped');
      logger.info(`Strategist session shutdown complete (succeeded=${this.succeeded})`);
    }
  }

  /**
   * Whether this session completed successfully. PlayerVictory from MCP is
   * deferred until after archival is on disk, so observing it is sufficient.
   * Only meaningful once `state === 'stopped'`.
   */
  get succeeded(): boolean {
    return this.victoryObserved;
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
   * The actual game playerID of the human-control seat, or `undefined` when no
   * seat uses the `human-strategist`. Resolves the config slot through the
   * seating map the same way `handleGameSwitched` does when it creates
   * VoxPlayers, so it honors `randomizeSeating`. Used to pin the observer-UI
   * override to the human's civ.
   */
  private get humanPlayerID(): number | undefined {
    const seatingMap = this.seatingClaim?.seatingMap;
    for (const [configSlotStr, playerConfig] of Object.entries(this.config.llmPlayers)) {
      if (playerConfig.strategist === "human-strategist") {
        return seatingMap?.[configSlotStr] ?? parseInt(configSlotStr);
      }
    }
    return undefined;
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

    // Load/wait mode binds to a game launched outside our control (typically a
    // resumed controlled save). Its seeds + seating are already baked in, so
    // instead of the loop assigning a fresh cell we recover the matching cell
    // from the launched game now — its per-game metadata is addressable once
    // GameSwitched fires. A failed match is fatal; route it through the error
    // path rather than throwing out of this (swallowed) notification handler.
    if (!this.seatingClaim) {
      try {
        this.seatingClaim = await this.recoverSeatingClaimFromGame();
      } catch (err) {
        const message = `Failed to match the launched game to the seating cycle: ${(err as Error).message}`;
        logger.error(message);
        this.onStateChange('error', message);
        this.abortController.abort();
        await voxCivilization.killGame();
        this.victoryResolve?.();
        return;
      }
    }

    // Bind the gameID to the current seating-cycle attempt so operators can
    // correlate cells to archive files. Idempotent across crash-recoveries:
    // each relaunch overwrites with the new gameID. No-op in trivial mode.
    if (this.seatingClaim) {
      await this.seatingManager.attachGameID(this.seatingClaim, params.gameID);
    }

    // Set OBS game ID for recording directory organization
    await this.obsCall('setGameID', () => obsManager.setGameID(params.gameID!));
    if (this.state === 'starting') this.onStateChange('running');

    // Abort all existing players. Cancel any pending human-decision wait so the
    // old strategist run rejects cleanly instead of awaiting a bus the new
    // VoxPlayers no longer drive — the fresh human-strategist re-presents the
    // decision (crash recovery, spec §6).
    this.humanDecisionBus.cancelAll(new Error("Game context switched; players recreated"));
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
      const player = new VoxPlayer(actualPlayerID, playerConfig, params.gameID, params.turn, this.humanDecisionBus, this.seatingClaim?.seeds?.sync, this);
      await player.context.registerTools();
      this.activePlayers.set(actualPlayerID, player);
      player.execute();
    }

    // `experiment` key — consumed by the archivist pipeline to group runs of
    // the same StrategistSessionConfig together for outcome analysis.
    await setMetadata("experiment", this.config.name);
    await setTimeout(3000);

    if (this.config.autoPlay && params.turn === 0) {
      // Autoplay. For human control, pin the observer UI to the human's civ
      // *before* SetAIAutoPlay — the team-visibility copy happens only at
      // autoplay activation, so ordering matters (human-control spec §2).
      const humanID = this.humanPlayerID;
      const overrideLine = humanID !== undefined ? `Game.SetObserverUIOverridePlayer(${humanID});\n` : "";
      // Pause the human seat *before* SetAIAutoPlay so its turn 0 (capital
      // founding + the engine's auto-pick doResearch) is held until the human
      // decides. The seat's execute() init resume-game already ran during player
      // creation, so this proactive pause is the net state. The decision is
      // presented below, once the UI/panel addin is live (post-LoadScreenClose).
      if (humanID !== undefined) await mcpClient.callTool("pause-game", { PlayerID: humanID });
      await mcpClient.callTool("lua-executor", {
        Script: `
Events.LoadScreenClose();
Game.SetPausePlayer(-1);
${overrideLine}Game.SetAIAutoPlay(2000, -1);`
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

    // Present the human's turn-0 decision now that the load screen is closed and
    // autoplay is running — so the VoxDeorumHumanDecision panel listener exists.
    // The seat was paused above, so its turn 0 stays held until the human submits;
    // the execute() loop then enacts the decision and issues the first resume-game.
    if (params.turn === 0 && this.humanPlayerID !== undefined) {
      this.activePlayers.get(this.humanPlayerID)?.notifyTurn(params.turn, params.latestID);
    }
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
   * Recover the seating claim for a game launched outside the fresh-start path
   * (`load`/`wait` mode). The Civ V gameID persists across save→load, so the
   * per-game metadata written by the original run is readable here: read back
   * the seating map, cycle coordinates, and Civ's observed pregame seeds, then
   * ask the manager for the cycle cell that reproduces them.
   *
   * Throws (surfaced as a session error by the caller) when nothing matches —
   * an unknown / fresh game with no seating metadata, or a cycle that drifted
   * since this save started.
   */
  private async recoverSeatingClaimFromGame(): Promise<SeatingClaim> {
    const [mapText, rotationText, seedIndexText, syncText, mapSeedText] = await Promise.all([
      getMetadata("seatingMap"),
      getMetadata("seatingRotation"),
      getMetadata("seatingSeedIndex"),
      getMetadata("syncRandSeed"),
      getMetadata("mapRandSeed"),
    ]);

    let seatingMap: Record<string, number> | undefined;
    if (mapText) {
      try {
        seatingMap = JSON.parse(mapText) as Record<string, number>;
      } catch {
        throw new Error(`launched game's seatingMap metadata is not valid JSON: "${mapText}"`);
      }
    }

    // Empty/missing metadata → undefined; a present-but-non-numeric value is
    // malformed and fails recovery early with a key-specific message.
    const parseNum = (text: string, key: string): number | undefined => {
      if (!text) return undefined;
      const n = Number(text);
      if (!Number.isFinite(n)) {
        throw new Error(`launched game's ${key} metadata is not a number: "${text}"`);
      }
      return n;
    };

    const observed: ObservedSeating = {
      seatingMap,
      rotation: parseNum(rotationText, "seatingRotation"),
      seedIndex: parseNum(seedIndexText, "seatingSeedIndex"),
      seeds: {
        sync: parseNum(syncText, "syncRandSeed"),
        map: parseNum(mapSeedText, "mapRandSeed"),
      },
    };
    return this.seatingManager.claimMatchingCell(observed);
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
      // Re-pin the observer UI to the human's civ. Defensive: the override —
      // like autoplay itself, which recovery also doesn't re-issue — is
      // serialized in saves, so a recovered human game already has it.
      const humanID = this.humanPlayerID;
      if (humanID !== undefined) {
        await mcpClient.callTool("lua-executor", { Script: `Game.SetObserverUIOverridePlayer(${humanID});` });
      }
      if (this.config.autoPlay && !isVisualMode(this.config.production)) {
        await setTimeout(3000);
        await mcpClient.callTool("lua-executor", { Script: `ToggleStrategicView();` });
      }
    }
  }

  /**
   * Handle Civ's `PlayerVictory` notification. MCP holds this notification
   * until after the game archive is on disk, so receiving it means both
   * "victory observed" and "archived". In autoplay mode this drives the whole
   * shutdown ritual; in interactive mode it just unblocks `start()` and lets
   * the caller (or process manager) drive teardown.
   */
  private async handlePlayerVictory(params: GameEventNotification): Promise<void> {
    logger.warn(`Player ${params.playerID} has won the game on turn ${params.turn}!`);

    this.victoryObserved = true;

    if (this.config.autoPlay) {
      // Unified shutdown handles voluntary game close, MCP disconnect,
      // seating release, and state→stopped. Idempotent, so the
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
   * Route an inbound `HumanDecision` event to the waiting human-strategist by
   * resolving the per-session decision bus for the notifying player. The event
   * payload (the human's choices) rides in the notification's top-level `data`
   * object (mcp-server forwards whitelisted event data there). A decision with
   * no pending request — e.g. one that races a crash-recovery cancel — is a
   * harmless no-op; the re-presented request will await the next submission.
   */
  private handleHumanDecision(params: GameEventNotification): void {
    const playerID = params.playerID;
    const submission = (params.data ?? {}) as HumanDecisionSubmission;
    const resolved = this.humanDecisionBus.resolve(playerID, submission);
    if (resolved) {
      logger.warn(`Human decision submitted for player ${playerID} on turn ${params.turn}`, params.data);
    } else {
      logger.warn(`Received a HumanDecision for player ${playerID} with no pending request; ignoring.`);
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
   * Release the active claim back to the cycle exactly once. The cell becomes
   * `completed` when `success` is true (PlayerVictory now implies archived,
   * since MCP defers the notification until after disk archive) — any other
   * outcome is a retry-or-fail release inside `SeatingStateManager.releaseCell`.
   * Idempotent (the `claimReleased` guard prevents double-release between the
   * victory and shutdown paths).
   */
  private async releaseSeatingClaim(success: boolean): Promise<void> {
    if (!this.seatingClaim || this.claimReleased) return;
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
  getPlayerAssignments(): Record<number, PlayerAssignment> {
    /** Short model name for an agent's per-agent override, if any. */
    const modelOf = (playerConfig: typeof this.config.llmPlayers[number], agent?: string): string | undefined => {
      if (!agent) return undefined;
      const m = playerConfig.llms?.[agent];
      return typeof m === 'string' ? m : m?.name;
    };

    const result: Record<number, PlayerAssignment> = {};
    for (const [configSlotStr, playerConfig] of Object.entries(this.config.llmPlayers)) {
      const configSlot = parseInt(configSlotStr);
      const actualPlayerID = this.seatingClaim?.seatingMap[configSlotStr] ?? configSlot;
      // The diplomat defaults to the built-in `diplomat` agent when a seat doesn't name one,
      // so the conversation route always has a voice to resolve. The negotiator stays optional
      // (unused until stage 5).
      const diplomat = playerConfig.diplomat ?? "diplomat";
      result[actualPlayerID] = {
        strategist: playerConfig.strategist,
        model: modelOf(playerConfig, playerConfig.strategist),
        diplomat,
        diplomatModel: modelOf(playerConfig, diplomat),
        negotiator: playerConfig.negotiator,
        negotiatorModel: modelOf(playerConfig, playerConfig.negotiator),
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
    const started = await voxCivilization.startGame(luaScript, playerCount, isVisualMode(this.config.production), this.seatingClaim?.seeds);

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
