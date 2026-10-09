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
import { ensureGameState, withEventWindowFallback, type GameState, StrategistParameters } from "./strategy-parameters.js";
import { VoxSpanExporter } from "../utils/telemetry/vox-exporter.js";
import type { FilesSetting, PlayerConfig, PromptsSetting, TriageSetting } from "../types/config.js";
import type { HumanDecisionBus } from "./human-decision-bus.js";
import { resolveSeatFiles, resolveSeatPrompts, resolveSeatTriage } from "./seat-config.js";
import { isScheduledDecision, normalizePacing, shouldInterruptDecision, type NormalizedPacingConfig } from "./pacing.js";

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
  private eventCursor: number;

  public readonly playerID: number;
  private readonly playerConfig: PlayerConfig;

  constructor({ playerID, slot, playerConfig, gameID, initialTurn, humanDecisionBus, syncSeed, session, triage, files, prompts }: VoxPlayerOptions) {
    this.playerID = playerID;
    this.playerConfig = playerConfig;
    this.logger = createLogger(`VoxPlayer-${playerID}`);
    // Throws on an unknown interruption name so misconfiguration fails fast.
    this.pacing = normalizePacing(playerConfig.pacing);

    const id = `${gameID}-player-${playerID}`
    VoxSpanExporter.getInstance().createContext(id, this.playerConfig.strategist);

    // Pass model overrides to VoxContext
    // Agents are now registered globally in agent-registry.ts
    this.context = new VoxContext(playerConfig.llms || {}, id);
    // Let the context reach its owning session for authoritative state (e.g. the live turn).
    this.context.session = session;
    // Set before the constructor returns: chats can reach the context by id as soon as it exists.
    this.context.triage = resolveSeatTriage(playerConfig, triage, slot);
    this.context.files = resolveSeatFiles(playerConfig, files, slot);
    this.context.prompts = resolveSeatPrompts(playerConfig, prompts, slot);

    this.parameters = {
      playerID,
      gameID,
      turn: -1,
      after: initialTurn * 1000000,
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

    // The persistent event cursor starts where the strategist begins fetching.
    this.eventCursor = initialTurn * 1000000;

    // Install these as the context's stable base parameters. Each strategist turn composes a
    // run-local view over this object (overriding turn/before/after via withRun), so the base is
    // never mutated per turn — a diplomat conversation opened before the first strategist turn
    // still reads valid seat state (gameStates, metadata, …) through it, and concurrent runs keep
    // their own turn cursor. Shared seat state (gameStates, workingMemory, metadata) lives here.
    this.context.setBaseParameters(this.parameters);
  }

  /**
   * Queue a turn notification for processing.
   * Notifications are queued if the agent is still processing the previous turn.
   *
   * @param turn - The turn number
   * @returns True if this is a new turn notification, false if duplicate
   */
  notifyTurn(turn: number): boolean {
    if (this.running) {
      this.logger.warn(`The ${this.playerConfig.strategist} is still working on turn ${this.parameters.turn}. Skipping turn ${turn}...`);
      this.context.callTool("pause-game", { PlayerID: this.playerID }, this.parameters).then(() => {
        if (!this.running) this.context.callTool("resume-game", { PlayerID: this.playerID }, this.parameters);
      });
      return this.pendingTurn !== turn;
    }

    const result = this.pendingTurn !== turn;
    this.pendingTurn = turn;
    return result;
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
        // Set the player's AI type
        await this.context.callTool("set-metadata", { Key: `strategist-${this.playerID}`, Value: this.playerConfig.strategist }, this.parameters);

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

          // Initializing. turn/before/after are run-local (passed to withRun as overrides), so the
          // context's base strategist parameters are never mutated per turn — concurrent diplomat
          // chats keep their own live turn. `after` starts at the persistent event cursor; the
          // cursor only advances after a successful refresh (below).
          this.pendingTurn = undefined;
          const turn = turnData;
          const before = turn * 1000000 + 999999;
          const after = this.eventCursor;
          const lastDecisionTurn = this.parameters.lastDecisionTurn;
          this.running = true;

          // Start a new trace for each turn (no parent)
          const turnSpan = tracer.startSpan(`strategist.turn.${turn}`, {
            root: true, // This makes it a new trace
            attributes: {
              'vox.context.id': this.context.id,
              'player.id': String(this.playerID),
              'game.turn': String(turn),
              'event.before': String(before),
              'event.after': String(after),
              'strategist.type': this.playerConfig.strategist,
              'pacing.every_turns': String(this.pacing.everyTurns),
              'pacing.interruption': this.pacing.interruption,
              'pacing.last_decision_turn': lastDecisionTurn === undefined ? "" : String(lastDecisionTurn)
            }
          });

          try {
            // Create a new root context for this turn's trace
            await context.with(trace.setSpan(context.active(), turnSpan), async () => {
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
                const state = await ensureGameState(this.context, params, cullLimit);
                // Advance the event cursor: we've now fetched events through this turn. The next
                // refresh fetches from here, so a turn dropped before it was processed folds its
                // events into the following fetch (nothing is lost). A failed refresh throws above,
                // leaving the cursor put so the next turn re-fetches the gap.
                this.eventCursor = before;

                const scheduled = isScheduledDecision(turn, lastDecisionTurn, this.pacing);
                const interrupted = shouldInterruptDecision(state, this.playerID, this.pacing);
                const shouldDecide = scheduled || interrupted;

                if (!shouldDecide) {
                  this.logger.info(
                    `Skipping ${this.playerConfig.strategist} on Turn ${turn} ` +
                    `(lastDecisionTurn=${lastDecisionTurn}, everyTurns=${this.pacing.everyTurns})`,
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
                    'pacing.interrupted': false,
                    'tokens.input': 0,
                    'tokens.reasoning': 0,
                    'tokens.output': 0,
                    // No deliberation on a paced skip (the strategist never ran).
                    'deliberation.ms': 0
                  });
                  turnSpan.setStatus({ code: SpanStatusCode.OK });
                  return;
                }

                const eventFromTurn = this.parameters._decisionEventWindow.fromTurn;
                this.logger.warn(`Running ${this.playerConfig.strategist} on Turn ${turn}`, {
                  GameID: params.gameID,
                  PlayerID: params.playerID,
                  scheduled,
                  interrupted
                });

                const decided = await this.executeDecisionWithEventFallback(params, state, eventFromTurn, turnSpan);

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
              message: error instanceof Error ? error.message : String(error)
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
          message: error instanceof Error ? error.message : String(error)
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

        // Best-effort metadata reporting - don't let failures prevent context shutdown
        try {
          await Promise.all([
            this.context.callTool("set-metadata", { Key: `inputTokens-${this.playerID}`, Value: String(this.context.inputTokens) }, this.parameters),
            this.context.callTool("set-metadata", { Key: `reasoningTokens-${this.playerID}`, Value: String(this.context.reasoningTokens) }, this.parameters),
            this.context.callTool("set-metadata", { Key: `outputTokens-${this.playerID}`, Value: String(this.context.outputTokens) }, this.parameters),
            sqliteExporter.forceFlush()
          ]);
        } catch (error) {
          this.logger.warn(`Failed to report final metadata for player ${this.playerID}:`, error);
        }

        // Shutdown the VoxContext to ensure all telemetry is flushed
        await this.context.shutdown();
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
   * Execute a decision, dropping lower importance events across the pending window on overflow,
   * then older turns' turning points as a last resort. Return false if nothing fits, so the
   * caller retains the pending history and retries next turn. The no-op "none" strategist
   * counts as success.
   */
  private async executeDecisionWithEventFallback(
    parameters: StrategistParameters,
    state: GameState,
    eventFromTurn: number,
    turnSpan: Span
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

      // Nested execution inside the established turn root: execute() uses the root's composed
      // parameters, inherits its cancellation, and accrues its tokens to the run handle.
      let contextLengthExceeded = false;
      await this.context.execute(this.playerConfig.strategist, undefined, undefined, undefined, () => {
        contextLengthExceeded = true;
      }, { throwOnError: true });

      if (!contextLengthExceeded) return true;

      this.logger.warn(
        `Context length exceeded on turn ${parameters.turn}; retrying with fewer events.`,
        {
          GameID: parameters.gameID,
          PlayerID: parameters.playerID,
          EventFrom: eventWindow.fromTurn,
          EventTo: eventWindow.toTurn,
          DroppedTiers: eventWindow.droppedTiers ?? 0
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
