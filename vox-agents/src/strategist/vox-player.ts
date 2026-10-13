/**
 * @module strategist/vox-player
 *
 * Individual player management for strategist sessions.
 * Each VoxPlayer manages one player's agent execution, context, and telemetry.
 * Handles turn notifications, agent execution loop, and token usage tracking.
 */

import { VoxContext } from "../infra/vox-context.js";
import type { VoxSession } from "../infra/vox-session.js";
import { trace, SpanStatusCode, context, type Span } from '@opentelemetry/api';
import { createLogger } from "../utils/logger.js";
import { setTimeout } from 'node:timers/promises';
import { sqliteExporter, spanProcessor } from "../instrumentation.js";
import { config } from "../utils/config.js";
import { ensureGameState, mergeCachedEvents, turnEventWindow, withEventWindowFallback, type GameState, StrategistParameters } from "./strategy-parameters.js";
import { agentRegistry } from "../infra/agent-registry.js";
import { runUsesFiles } from "../knowledge/directions.js";
import { resolveRunTools } from "../infra/vox-execute.js";
import type { ResolvedRunTools } from "../infra/vox-run.js";
import { VoxSpanExporter } from "../utils/telemetry/vox-exporter.js";
import type { FilesSetting, ModelSize, PlayerConfig, PromptsSetting, TriageSetting } from "../types/config.js";
import type { HumanDecisionBus } from "./human-decision-bus.js";
import { resolveSeatFiles, resolveSeatPrompts, resolveSeatTriage } from "./seat-config.js";
import { isScheduledDecision, normalizePacing, resolvePacingVerdict, shouldInterruptDecision, type NormalizedPacingConfig } from "./pacing.js";
import { runStrategistTriage } from "./pacing/triage.js";
import { countTokens } from "../utils/models/token-counter.js";
import { jsonToMarkdown } from "../utils/tools/json-to-markdown.js";
import { errorMessage } from "../utils/errors.js";
import { setMetadata } from "../utils/game/metadata.js";
import { WorkspaceStore } from "../utils/workspace/workspace-store.js";

/** Where a turn notification came from: a real `PlayerDoneTurn`, or the session's proactive human startup turn. */
export type TurnSource = 'done' | 'startup';

/** Construction inputs for one seat's {@link VoxPlayer}. */
export interface VoxPlayerOptions {
  /** The actual in-game player index this seat controls. */
  playerID: number;
  /** The seat's key in the session's `llmPlayers`, named in configuration errors. */
  slot: string;
  playerConfig: PlayerConfig;
  gameID: string;
  initialTurn: number;
  humanDecisionBus: HumanDecisionBus;
  syncSeed?: number;
  /** The owning session, reachable from the seat context. */
  session?: VoxSession;
  /** The session config's top-level triage setting, which the seat's own setting overrides. */
  triage?: TriageSetting;
  /** The session config's top-level files setting, which the seat's own setting overrides. */
  files?: FilesSetting;
  /** The session config's top-level prompts setting, which the seat's own setting overrides. */
  prompts?: PromptsSetting;
}

/**
 * Manages a single player's strategist execution within a game session.
 * Each player gets its own VoxContext, observation span, and execution loop.
 * Tracks token usage and reports telemetry via OpenTelemetry.
 *
 * @class
 */
export class VoxPlayer {
  public readonly context: VoxContext<StrategistParameters>;
  private parameters: StrategistParameters & { _decisionEventWindow: { fromTurn: number } };
  private logger;
  private pendingTurn?: number;
  private aborted = false;
  private running = false;
  private successful = false;
  private readonly pacing: NormalizedPacingConfig;
  /**
   * Persistent event cursor: the highest event ID fetched so far. Each turn's root reads events
   * `after` this value and the cursor advances to the turn's `before` only after a successful
   * refresh, so a failed refresh leaves it put and the next turn re-fetches the gap. Lives on the
   * player (not the shared parameters) so concurrent chat/analyst runs can't disturb it.
   */
  private eventCursor = 0;
  /** The last turn the loop accepted, or N - 1 after a timeline start at N. Undefined until a start succeeds. */
  private lastProcessedTurn?: number;
  /** The lowest turn a reload must cut at, kept until a timeline start succeeds. */
  private pendingReload?: number;
  /** The session's proactive startup turn whose first real notification is still expected. */
  private startupTurn?: number;
  /** Consecutive turns whose game-state refresh failed. Reset by any successful refresh. */
  private refreshFailures = 0;

  public readonly playerID: number;
  private readonly playerConfig: PlayerConfig;

  constructor({ playerID, slot, playerConfig, gameID, initialTurn, humanDecisionBus, syncSeed, session, triage, files, prompts }: VoxPlayerOptions) {
    this.playerID = playerID;
    this.playerConfig = playerConfig;
    this.logger = createLogger(`VoxPlayer-${playerID}`);
    // Throws on an unknown interruption name so misconfiguration fails fast.
    this.pacing = normalizePacing(playerConfig.pacing);
    // Resolve the seat settings first so an invalid one throws before anything is opened.
    const seatTriage = resolveSeatTriage(playerConfig, triage, slot);
    const seatFiles = resolveSeatFiles(playerConfig, files, slot);
    const seatPrompts = resolveSeatPrompts(playerConfig, prompts, slot);
    // A file-enabled seat opens its store now, because its first timeline start may rewind it.
    // An open failure throws, which the session treats as a setup failure.
    const store = seatFiles ? WorkspaceStore.open(WorkspaceStore.pathFor(gameID, playerID)) : undefined;

    try {
      const id = `${gameID}-player-${playerID}`
      VoxSpanExporter.getInstance().createContext(id, this.playerConfig.strategist);

      // Pass model overrides to VoxContext
      // Agents are now registered globally in agent-registry.ts
      this.context = new VoxContext(playerConfig.llms || {}, id);
    } catch (error) {
      store?.close();
      throw error;
    }
    // Let the context reach its owning session for authoritative state (e.g. the live turn).
    this.context.session = session;
    // Set before the constructor returns: chats can reach the context by id as soon as it exists.
    this.context.triage = seatTriage;
    this.context.files = seatFiles;
    this.context.prompts = seatPrompts;
    this.context.store = store;

    // The timeline fields (event window and cursor, cached states, memory) are set by beginTimeline.
    this.parameters = {
      playerID,
      gameID,
      turn: -1,
      after: 0,
      before: 0,
      workingMemory: {},
      gameStates: {},
      _decisionEventWindow: { fromTurn: initialTurn },
      mode: playerConfig.strategist === "none-strategist" ? "Strategy" : (playerConfig.mode ?? "Flavor"),
      syncSeed,
      // Populated for every seat; only the human strategist reads it (to block
      // on and receive the in-game panel's submission).
      _humanDecisionBus: humanDecisionBus
    };

    // Install these as the context's stable base parameters. Each strategist turn composes a
    // run-local view over this object (overriding turn/before/after via withRun), so the base is
    // never mutated per turn — a diplomat conversation opened before the first strategist turn
    // still reads valid seat state (gameStates, metadata, …) through it, and concurrent runs keep
    // their own turn cursor. Shared seat state (gameStates, workingMemory, metadata) lives here.
    this.context.setBaseParameters(this.parameters);

    // A rewind that fails here is retried by the first processed turn.
    try {
      this.beginTimeline(initialTurn);
    } catch (error) {
      this.logger.error(`Player ${playerID} (${gameID}) failed to start its timeline at turn ${initialTurn}; the first turn retries it.`, error);
      this.pendingReload = initialTurn;
    }
  }

  /**
   * Start the seat's timeline at a turn, for a new session or after a reload. Cancels the seat's
   * active runs, resets its live state in place (runs hold references to the base parameters),
   * and rewinds the seat store so records and notes from turn N on leave the seat's view. Game
   * metadata stays, because the game is the same. Runs synchronously.
   *
   * @param turn - The first turn of the new timeline
   * @throws when the store rewind fails; the reload then stays pending
   */
  private beginTimeline(turn: number): void {
    this.context.abort();

    const parameters = this.parameters;
    for (const key of Object.keys(parameters.gameStates)) delete parameters.gameStates[Number(key)];
    for (const key of Object.keys(parameters.workingMemory)) delete parameters.workingMemory[key];
    delete parameters.lastDecisionTurn;
    parameters._decisionEventWindow.fromTurn = turn;
    parameters.after = turnEventWindow(turn).after;
    this.eventCursor = turnEventWindow(turn).after;
    this.startupTurn = undefined;
    this.refreshFailures = 0;

    // Only file-enabled seats have a store; the others make no store calls.
    this.context.store?.rewind(turn);

    this.lastProcessedTurn = turn - 1;
    this.pendingReload = undefined;
  }

  /**
   * Queue a turn notification for processing. A notification that arrives while the agent is
   * still processing the previous turn is dropped, and the seat is held until that turn finishes.
   *
   * The first real notification for the session's startup turn is consumed without processing that
   * turn again. Any other real notification at or below the last processed turn is a reload: the
   * lowest such turn stays pending, even while busy, and the next accepted turn starts a new
   * timeline from there.
   *
   * @param turn - The turn number
   * @param source - `startup` for the session's proactive human turn, `done` for a real `PlayerDoneTurn`
   * @returns True if this is a new turn notification, false if duplicate or consumed
   */
  notifyTurn(turn: number, source: TurnSource = 'done'): boolean {
    if (source === 'startup') {
      this.startupTurn = turn;
    } else if (this.startupTurn === turn) {
      // The real notification for the startup turn, whether that turn is queued, running, or finished.
      this.startupTurn = undefined;
      if (this.running) this.holdWhileBusy(turn);
      return false;
    } else {
      if (this.startupTurn !== undefined && turn > this.startupTurn) this.startupTurn = undefined;
      if (this.lastProcessedTurn !== undefined && turn <= this.lastProcessedTurn) {
        this.pendingReload = Math.min(this.pendingReload ?? turn, turn);
        this.logger.warn(`Turn ${turn} arrived after turn ${this.lastProcessedTurn} was processed; the seat reloads from turn ${this.pendingReload}.`);
      }
    }

    if (this.running) {
      this.holdWhileBusy(turn);
      return this.pendingTurn !== turn;
    }

    const result = this.pendingTurn !== turn;
    this.pendingTurn = turn;
    return result;
  }

  /**
   * Forget the startup acknowledgement. The session calls this when the DLL reconnects after a
   * disconnection, so a recovered startup-turn notification counts as a reload.
   */
  clearStartupAcknowledgement(): void {
    this.startupTurn = undefined;
  }

  /**
   * Forget earlier failed refreshes. The session calls this when the DLL reconnects, because a
   * crash fails the refresh in flight and same-game recovery keeps this player.
   */
  resetRefreshFailures(): void {
    this.refreshFailures = 0;
  }

  /**
   * Close the seat store. The loop calls this after its context shuts down, and the session calls
   * it for a player whose loop never started. Safe to call more than once.
   */
  closeStore(): void {
    const store = this.context.store;
    if (!store) return;
    this.context.store = undefined;
    store.close();
  }

  /**
   * Release a player whose loop never started: shut down its context, which flushes telemetry
   * and unregisters it, then close the seat store. The loop does the same when it ends.
   */
  async dispose(): Promise<void> {
    this.aborted = true;
    try {
      await this.context.shutdown();
    } finally {
      this.closeStore();
    }
  }

  /** Drop a notification that arrived while busy, holding the seat until the current turn finishes. */
  private holdWhileBusy(turn: number): void {
    this.logger.warn(`The ${this.playerConfig.strategist} is still working on turn ${this.parameters.turn}. Skipping turn ${turn}...`);
    this.context.callTool("pause-game", { PlayerID: this.playerID }, this.parameters).then(() => {
      if (!this.running) this.context.callTool("resume-game", { PlayerID: this.playerID }, this.parameters);
    });
  }

  /**
   * Main execution loop with observation span.
   * Processes turn notifications and executes the strategist agent for each turn.
   * Tracks telemetry and token usage throughout the game.
   */
  async execute(): Promise<void> {
    const tracer = trace.getTracer('vox-player');
    const span = tracer.startSpan(`player.${this.parameters.gameID}.${this.playerID}`, {
      attributes: {
        'vox.context.id': this.context.id,
        'player.id': this.playerID,
        'game.id': this.parameters.gameID,
        'strategist.type': this.playerConfig.strategist,
        'config.version': config.versionInfo?.version || "unknown"
      }
    });

    return await context.with(trace.setSpan(context.active(), span), async () => {
      try {
        // Set the player's AI type (straight to MCP so the label write stays out of telemetry spans)
        try {
          await setMetadata(`strategist-${this.playerID}`, this.playerConfig.strategist);
        } catch (error) {
          this.logger.error(`Failed to set strategist label for player ${this.playerID}:`, error);
        }

        // Resume the game in case the vox agent was aborted
        await this.context.callTool("resume-game", { PlayerID: this.playerID }, this.parameters);

        while (!this.aborted) {

          const turnData = this.pendingTurn;
          if (turnData === undefined) {
            this.running = false;
            await setTimeout(10);
            continue;
          }

          // Pause gate. Stall the game by holding the seat, then wait for the session to resume.
          // A failed hold is retried on each poll; once it succeeds, the seat is not re-paused.
          // The pending turn stays queued, so resumption picks it right up (no PlayerDoneTurn
          // can re-arm it while the seat is held).
          if (this.context.session?.isPaused()) {
            let held = false;
            while (this.context.session.isPaused() && !this.aborted) {
              if (!held) {
                held = await this.context.callTool("pause-game", { PlayerID: this.playerID }, this.parameters) === true;
                if (!held) this.logger.warn(`Failed to hold player ${this.playerID} for the session pause; retrying...`);
              }
              await setTimeout(200);
            }
            continue;
          }

          // Accept the turn. It counts as processed from here, before any work is awaited, so a
          // repeated notification for it while it runs is detected as a reload.
          this.pendingTurn = undefined;
          const turn = turnData;
          const reloadTurn = this.pendingReload === undefined ? undefined : Math.min(this.pendingReload, turn);
          this.lastProcessedTurn = turn;
          this.running = true;

          // Start a new trace for each turn (no parent)
          const turnSpan = tracer.startSpan(`strategist.turn.${turn}`, {
            root: true, // This makes it a new trace
            attributes: {
              'vox.context.id': this.context.id,
              'player.id': String(this.playerID),
              'game.turn': String(turn),
              'strategist.type': this.playerConfig.strategist,
              'pacing.every_turns': String(this.pacing.everyTurns),
              'pacing.interruption': this.pacing.interruption,
              'timeline.reload_turn': reloadTurn === undefined ? "" : String(reloadTurn)
            }
          });

          try {
            // Create a new root context for this turn's trace
            await context.with(trace.setSpan(context.active(), turnSpan), async () => {
              // A pending reload starts a new timeline before the turn's root run exists, because
              // its abort would cancel that run too. A failed rewind fails this turn (neither
              // recorded nor decided) and the reload stays pending for the next turn.
              if (reloadTurn !== undefined) {
                this.beginTimeline(reloadTurn);
                this.lastProcessedTurn = turn;
              }

              // turn/before/after are run-local (passed to withRun as overrides), so the context's
              // base strategist parameters are never mutated per turn — concurrent diplomat chats
              // keep their own live turn. `after` starts at the persistent event cursor; the cursor
              // only advances after a successful refresh and record (below).
              const before = turnEventWindow(turn).before;
              const after = this.eventCursor;
              const lastDecisionTurn = this.parameters.lastDecisionTurn;
              turnSpan.setAttributes({
                'event.before': String(before),
                'event.after': String(after),
                'pacing.last_decision_turn': lastDecisionTurn === undefined ? "" : String(lastDecisionTurn)
              });

              // One root run per turn owns this turn's cancellation, token sink, and the run-local
              // turn/before/after. It covers pause, refresh, pacing, the optional LLM decision, and
              // resume — all the work belonging to this strategist turn.
              await this.context.withRun({ overrides: { turn, before, after } }, async (run) => {
                const params = run.parameters;
                await this.context.callTool("pause-game", { PlayerID: this.playerID }, params);
                // Refresh all strategy parameters
                const cullLimit = Math.max(10, this.pacing.everyTurns + 1);
                // Pending decision events never reach back past the normal cache, so repeated
                // failures cannot pin history forever.
                this.releasePendingEventsBefore(turn - cullLimit + 1);
                let state: GameState;
                try {
                  state = await ensureGameState(this.context, params, cullLimit);
                } catch (error) {
                  if (!this.aborted && !run.signal.aborted) this.noteRefreshFailure(turn, error);
                  throw error;
                }
                this.refreshFailures = 0;
                // Record the processed turn before pacing can skip or decide. A failed write
                // throws and fails the turn like a failed refresh.
                if (this.context.files) this.context.records()?.recordTurn(params, state);
                // Advance the event cursor: we've now fetched events through this turn. The next
                // refresh fetches from here, so a turn dropped before it was processed folds its
                // events into the following fetch (nothing is lost). A failed refresh or record
                // throws above, leaving the cursor put so the next turn re-fetches the gap.
                this.eventCursor = before;

                const scheduled = isScheduledDecision(turn, lastDecisionTurn, this.pacing);
                const interrupted = shouldInterruptDecision(state, this.playerID, this.pacing);
                const eventFromTurn = this.parameters._decisionEventWindow.fromTurn;
                // Undefined when triage is off for this strategist or has no evaluator.
                const triage = await runStrategistTriage(this.context, params, state, this.playerConfig.strategist, eventFromTurn);
                const verdict = resolvePacingVerdict({ scheduled, interrupted, triage });
                turnSpan.setAttribute('pacing.triage', triage ?? "");

                if (!verdict.decide) {
                  this.logger.info(
                    `Skipping ${this.playerConfig.strategist} on Turn ${turn} ` +
                    `(reason=${verdict.reason}, lastDecisionTurn=${lastDecisionTurn}, everyTurns=${this.pacing.everyTurns})`,
                    { GameID: params.gameID, PlayerID: params.playerID }
                  );
                  // Re-apply the current AI settings without recording a decision,
                  // preventing VPAI from retaking control during paced skips. The
                  // "[skipped]" sentinel tells keep-status-quo to refresh without
                  // recording a strategic decision.
                  await this.context.callTool("keep-status-quo", {
                    PlayerID: this.playerID,
                    Mode: params.mode,
                    Rationale: "[skipped]"
                  }, params);

                  this.running = false;
                  await this.context.callTool("resume-game", { PlayerID: this.playerID }, params);

                  turnSpan.setAttributes({
                    'completed': true,
                    'pacing.skipped': true,
                    'pacing.skip_reason': verdict.reason,
                    'pacing.interrupted': false,
                    // Only triage's evaluation, if any, used tokens on a skipped turn.
                    'tokens.input': run.tokens.inputTokens,
                    'tokens.reasoning': run.tokens.reasoningTokens,
                    'tokens.output': run.tokens.outputTokens,
                    // No deliberation on a paced skip (the strategist never ran).
                    'deliberation.ms': 0
                  });
                  turnSpan.setStatus({ code: SpanStatusCode.OK });
                  return;
                }

                this.logger.warn(`Running ${this.playerConfig.strategist} on Turn ${turn}`, {
                  GameID: params.gameID,
                  PlayerID: params.playerID,
                  scheduled,
                  interrupted,
                  tier: verdict.tier
                });

                const decided = await this.executeDecision(params, state, eventFromTurn, turnSpan, verdict.tier);

                // Finalizing (the event cursor was already advanced after the refresh).
                // Only record a decision that was actually made and not cancelled. Otherwise
                // the event floor and lastDecisionTurn stay put, so this turn still counts as
                // scheduled next turn: we retry next turn rather than waiting until the next
                // paced decision point.
                if (decided && !run.signal.aborted) this.recordDecision(turn);

                // Recording the tokens and resume the game
                this.running = false;
                await this.context.callTool("resume-game", { PlayerID: this.playerID }, params);

                // Update the status. Per-turn token usage comes from this run's handle — the
                // strategist plus its nested briefers/negotiators only, never a concurrent chat's
                // tokens (those accrue to their own root).
                turnSpan.setAttributes({
                  'completed': true,
                  'pacing.skipped': false,
                  'pacing.decided': decided,
                  'pacing.interrupted': interrupted,
                  'pacing.tier': verdict.tier ?? "",
                  'tokens.input': run.tokens.inputTokens,
                  'tokens.reasoning': run.tokens.reasoningTokens,
                  'tokens.output': run.tokens.outputTokens,
                  // Human deliberation time for this turn (the human strategist
                  // stashes it in workingMemory; 0/absent for non-human seats).
                  'deliberation.ms': Number(params.workingMemory["deliberationMs"] ?? "0")
                });
                turnSpan.setStatus({ code: SpanStatusCode.OK });
              });
            });
          } catch (error) {
            this.logger.error(`Player ${this.playerID} (${this.parameters.gameID}) execution error:`, error);
            turnSpan.recordException(error as Error);
            turnSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: errorMessage(error)
            });
            // Still need to resume the game to avoid a total block. The event
            // cursor is left as-is: if the refresh succeeded it already advanced;
            // if it failed the cursor stays put so the next turn re-fetches the gap.
            this.running = false;
            await this.context.callTool("resume-game", { PlayerID: this.playerID }, this.parameters);
          } finally {
            turnSpan.end();
            await spanProcessor.forceFlush();
          }
        }

        this.successful = true;
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        this.logger.error(`Player ${this.playerID} (${this.parameters.gameID}) initializing error:`, error);
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: errorMessage(error)
        });
      } finally {
        this.logger.info(`Player ${this.playerID} (${this.parameters.gameID}) completion: ${this.aborted} (successful: ${this.successful})`);

        span.setAttributes({
          'completed': this.successful,
          'tokens.input': this.context.inputTokens,
          'tokens.reasoning': this.context.reasoningTokens,
          'tokens.output': this.context.outputTokens
        });
        span.end();

        // Best-effort metadata reporting - don't let failures prevent context shutdown.
        // Goes straight to MCP so the token bookkeeping writes stay out of telemetry spans.
        try {
          await Promise.all([
            setMetadata(`inputTokens-${this.playerID}`, this.context.inputTokens),
            setMetadata(`reasoningTokens-${this.playerID}`, this.context.reasoningTokens),
            setMetadata(`outputTokens-${this.playerID}`, this.context.outputTokens),
            sqliteExporter.forceFlush()
          ]);
        } catch (error) {
          this.logger.warn(`Failed to report final metadata for player ${this.playerID}:`, error);
        }

        // Shutdown the VoxContext to ensure all telemetry is flushed, then close the seat store,
        // which the context's runs may use until they stop.
        try {
          await this.context.shutdown();
        } finally {
          this.closeStore();
        }
        await setTimeout(5000);
      }
    });
  }

  /**
   * Abort the player's execution.
   * Sets the abort flag and notifies the context to stop any running generation.
   *
   * @param successful - Whether the abort is due to successful game completion
   */
  abort(successful = false): void {
    this.logger.info(`Aborting player ${this.playerID} (successful: ${successful})`);
    this.aborted = true;
    this.successful = successful;
    this.context.abort(successful);
  }

  /**
   * Get the context ID for this player.
   * Used for telemetry tracking.
   *
   * @returns The VoxContext ID or undefined if not set
   */
  getContextId(): string | undefined {
    return this.context?.id;
  }

  /**
   * Record a completed decision. Pacing counts from this turn, and pending decision events
   * restart after it. lastDecisionTurn is seat-wide base state read by the strategist prompt;
   * only the strategist root writes it (a chat root must never).
   */
  private recordDecision(turn: number): void {
    this.parameters.lastDecisionTurn = turn;
    this.parameters._decisionEventWindow.fromTurn = turn + 1;
  }

  /**
   * Count a failed game-state refresh. On the second consecutive failure, pause the whole
   * session: the seat cannot decide without game state, so letting the game run on would only
   * burn turns (and tokens on other seats). The turn's catch still resumes the game, and the
   * pause gate holds the seat on the next turn until someone resumes the session. Failures
   * caused by a crash don't add up: a DLL reconnect or a reload clears the count.
   */
  private noteRefreshFailure(turn: number, error: unknown): void {
    this.refreshFailures++;
    if (this.refreshFailures < 2) return;
    const session = this.context.session;
    if (!session || session.isPaused()) return;
    this.logger.error(
      `Pausing session: player ${this.playerID} failed to read the game state on ${this.refreshFailures} consecutive turns (latest: turn ${turn}): ${errorMessage(error)}`,
      { GameID: this.parameters.gameID, PlayerID: this.playerID }
    );
    session.pause();
  }

  /** Stop retaining pending decision events before `turn`, logging the turns a seat gives up. */
  private releasePendingEventsBefore(turn: number): void {
    const window = this.parameters._decisionEventWindow;
    if (window.fromTurn >= turn) return;
    this.logger.warn(
      `No decision has covered turns ${window.fromTurn}-${turn - 1}; releasing their pending events.`,
      { GameID: this.parameters.gameID, PlayerID: this.playerID }
    );
    window.fromTurn = turn;
  }

  /**
   * Execute a decision through the strategist's event input path. A strategist that reads events
   * from files runs once; every other strategist gets the inline event fallback. Return false
   * when the decision did not fit, so the caller retains the pending history and retries next turn.
   */
  private async executeDecision(
    parameters: StrategistParameters,
    state: GameState,
    eventFromTurn: number,
    turnSpan: Span,
    tier?: ModelSize
  ): Promise<boolean> {
    // Resolve once and pass the declaration into every attempt, so event handling and prompt
    // preparation use the same tools.
    const agent = agentRegistry.get<StrategistParameters>(this.playerConfig.strategist);
    const runTools = agent && await resolveRunTools(agent, parameters, undefined, this.context);
    const filesInput = runTools !== undefined && runUsesFiles(this.context, runTools.tools);
    turnSpan.setAttribute('event.input', filesInput ? 'files' : 'inline');
    if (!filesInput) return this.executeDecisionWithEventFallback(parameters, state, eventFromTurn, turnSpan, runTools, tier);

    // Briefers of a briefed or staffed strategist still read the pending window inline. On
    // overflow they trim this shared window and retry themselves, so the strategist never reruns.
    state.mergedEvents = mergeCachedEvents(parameters, eventFromTurn, parameters.turn);
    turnSpan.setAttributes({ event_from: eventFromTurn, event_to: parameters.turn, event_dropped_tiers: 0 });
    if (await this.executeStrategist(runTools, tier)) return true;
    this.logger.warn(
      `Context length exceeded on turn ${parameters.turn} with file input; abandoning the decision to retry next turn.`,
      { GameID: parameters.gameID, PlayerID: parameters.playerID }
    );
    return false;
  }

  /**
   * Run the seat's strategist once inside the turn root. Return false when it exceeded the
   * context length. A tier from triage overrides the strategist's own.
   */
  private async executeStrategist(runTools: ResolvedRunTools | undefined, tier?: ModelSize): Promise<boolean> {
    // Nested execution inside the established turn root: execute() uses the root's composed
    // parameters, inherits its cancellation, and accrues its tokens to the run handle.
    let contextLengthExceeded = false;
    await this.context.execute(this.playerConfig.strategist, undefined, undefined, undefined, () => {
      contextLengthExceeded = true;
    }, { throwOnError: true, triage: tier && { tier, note: "pacing" }, runTools });
    return !contextLengthExceeded;
  }

  /**
   * Execute an inline-event decision, dropping lower importance events across the pending window
   * on overflow, then older turns' turning points as a last resort. Return false if nothing fits.
   * The no-op "none" strategist counts as success.
   */
  private async executeDecisionWithEventFallback(
    parameters: StrategistParameters,
    state: GameState,
    eventFromTurn: number,
    turnSpan: Span,
    runTools: ResolvedRunTools | undefined,
    tier?: ModelSize
  ): Promise<boolean> {
    const decided = await withEventWindowFallback(parameters, state, eventFromTurn, async (eventWindow) => {
      if (eventWindow.fromTurn > eventFromTurn) {
        this.logger.warn(
          `Turning points still exceed the context on turn ${parameters.turn}; dropping events from turns ${eventFromTurn}-${eventWindow.fromTurn - 1}.`,
          { GameID: parameters.gameID, PlayerID: parameters.playerID }
        );
      }
      turnSpan.setAttributes({
        event_from: eventWindow.fromTurn,
        event_to: eventWindow.toTurn,
        event_dropped_tiers: eventWindow.droppedTiers ?? 0
      });

      if (await this.executeStrategist(runTools, tier)) return true;

      this.logger.warn(
        `Context length exceeded on turn ${parameters.turn}; retrying with fewer events.`,
        {
          GameID: parameters.gameID,
          PlayerID: parameters.playerID,
          EventFrom: eventWindow.fromTurn,
          EventTo: eventWindow.toTurn,
          DroppedTiers: eventWindow.droppedTiers ?? 0,
          // Size of this try's event window, to compare with the overflowing agent's token split.
          EventTokens: countTokens(jsonToMarkdown(state.mergedEvents ?? {}))
        }
      );
      return false;
    });

    if (!decided) {
      this.logger.warn(
        `Context length exceeded on turn ${parameters.turn}; abandoning the decision to retry next turn.`,
        {
          GameID: parameters.gameID,
          PlayerID: parameters.playerID
        }
      );
    }

    return decided;
  }
}
