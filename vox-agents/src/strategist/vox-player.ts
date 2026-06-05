/**
 * @module strategist/vox-player
 *
 * Individual player management for strategist sessions.
 * Each VoxPlayer manages one player's agent execution, context, and telemetry.
 * Handles turn notifications, agent execution loop, and token usage tracking.
 */

import { VoxContext } from "../infra/vox-context.js";
import { trace, SpanStatusCode, context, type Span } from '@opentelemetry/api';
import { createLogger } from "../utils/logger.js";
import { setTimeout } from 'node:timers/promises';
import { sqliteExporter, spanProcessor } from "../instrumentation.js";
import { config } from "../utils/config.js";
import { ensureGameState, withEventWindowFallback, type GameState, StrategistParameters } from "./strategy-parameters.js";
import { VoxSpanExporter } from "../utils/telemetry/vox-exporter.js";
import { PlayerConfig } from "../types/config.js";
import { isScheduledDecision, normalizePacing, shouldInterruptDecision, type NormalizedPacingConfig } from "./pacing.js";

/**
 * Manages a single player's strategist execution within a game session.
 * Each player gets its own VoxContext, observation span, and execution loop.
 * Tracks token usage and reports telemetry via OpenTelemetry.
 *
 * @class
 */
export class VoxPlayer {
  public readonly context: VoxContext<StrategistParameters>;
  private parameters: StrategistParameters;
  private logger;
  private pendingTurn?: { turn: number; latestID: number };
  private aborted = false;
  private running = false;
  private successful = false;
  private readonly pacing: NormalizedPacingConfig;
  private lastDecisionTurn?: number;

  constructor(
    public readonly playerID: number,
    private readonly playerConfig: PlayerConfig,
    gameID: string,
    initialTurn: number
  ) {
    this.logger = createLogger(`VoxPlayer-${playerID}`);
    // Throws on an unknown interruption name so misconfiguration fails fast.
    this.pacing = normalizePacing(playerConfig.pacing);

    const id = `${gameID}-player-${playerID}`
    VoxSpanExporter.getInstance().createContext(id, this.playerConfig.strategist);

    // Pass model overrides to VoxContext
    // Agents are now registered globally in agent-registry.ts
    this.context = new VoxContext(playerConfig.llms || {}, id);

    this.parameters = {
      playerID,
      gameID,
      turn: -1,
      after: initialTurn * 1000000,
      before: 0,
      workingMemory: {},
      gameStates: {},
      mode: playerConfig.strategist === "none-strategist" ? "Strategy" : (playerConfig.mode ?? "Flavor")
    };
  }

  /**
   * Queue a turn notification for processing.
   * Notifications are queued if the agent is still processing the previous turn.
   *
   * @param turn - The turn number
   * @param latestID - Latest event ID from the game
   * @returns True if this is a new turn notification, false if duplicate
   */
  notifyTurn(turn: number, latestID: number): boolean {
    if (this.running) {
      this.logger.warn(`The ${this.playerConfig.strategist} is still working on turn ${this.parameters.turn}. Skipping turn ${turn}...`);
      this.context.callTool("pause-game", { PlayerID: this.playerID }, this.parameters).then(() => {
        if (!this.running) this.context.callTool("resume-game", { PlayerID: this.playerID }, this.parameters);
      });
      return this.pendingTurn?.turn !== turn;
    }

    const result = this.pendingTurn?.turn !== turn;
    this.pendingTurn = { turn, latestID };
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
          if (!turnData) {
            this.running = false;
            await setTimeout(10);
            continue;
          }

          // Initializing
          this.pendingTurn = undefined;
          this.parameters.turn = turnData.turn;
          this.parameters.lastDecisionTurn = this.lastDecisionTurn;
          this.parameters.before = turnData.turn * 1000000 + 999999;
          this.running = true;

          // Logging
          const startingInput = this.context.inputTokens;
          const startingReasoning = this.context.reasoningTokens;
          const startingOutput = this.context.outputTokens;

          // Start a new trace for each turn (no parent)
          const turnSpan = tracer.startSpan(`strategist.turn.${this.parameters.turn}`, {
            root: true, // This makes it a new trace
            attributes: {
              'vox.context.id': this.context.id,
              'player.id': String(this.playerID),
              'game.turn': String(this.parameters.turn),
              'event.before': String(this.parameters.before),
              'event.after': String(this.parameters.after),
              'strategist.type': this.playerConfig.strategist,
              'pacing.every_turns': String(this.pacing.everyTurns),
              'pacing.interruption': this.pacing.interruption,
              'pacing.last_decision_turn': this.lastDecisionTurn === undefined ? "" : String(this.lastDecisionTurn)
            }
          });

          try {
            // Create a new root context for this turn's trace
            await context.with(trace.setSpan(context.active(), turnSpan), async () => {
              // Refresh all strategy parameters
              const cullLimit = Math.max(10, this.pacing.everyTurns + 1);
              const state = await ensureGameState(this.context, this.parameters, cullLimit);
              // Advance the event cursor: we've now fetched events through this turn.
              // The next refresh fetches from here, so a turn dropped before it was
              // processed folds its events into the following fetch (nothing is lost).
              // Runs for both skip and decision paths, giving clean per-turn slices.
              this.parameters.after = this.parameters.before;
              await this.context.callTool("pause-game", { PlayerID: this.playerID }, this.parameters);

              const scheduled = isScheduledDecision(this.parameters.turn, this.lastDecisionTurn, this.pacing);
              const interrupted = shouldInterruptDecision(state, this.playerID, this.pacing);
              const shouldDecide = scheduled || interrupted;

              if (!shouldDecide) {
                this.logger.info(
                  `Skipping ${this.playerConfig.strategist} on Turn ${this.parameters.turn} ` +
                  `(lastDecisionTurn=${this.lastDecisionTurn}, everyTurns=${this.pacing.everyTurns})`,
                  { GameID: this.parameters.gameID, PlayerID: this.parameters.playerID }
                );
                // Re-apply the current AI settings without recording a decision,
                // preventing VPAI from retaking control during paced skips. The
                // "[skipped]" sentinel tells keep-status-quo to refresh without
                // recording a strategic decision.
                await this.context.callTool("keep-status-quo", {
                  PlayerID: this.playerID,
                  Mode: this.parameters.mode,
                  Rationale: "[skipped]"
                }, this.parameters);

                this.running = false;
                await this.context.callTool("resume-game", { PlayerID: this.playerID }, this.parameters);

                turnSpan.setAttributes({
                  'completed': true,
                  'pacing.skipped': true,
                  'pacing.interrupted': false,
                  'tokens.input': 0,
                  'tokens.reasoning': 0,
                  'tokens.output': 0
                });
                turnSpan.setStatus({ code: SpanStatusCode.OK });
                return;
              }

              const eventFromTurn = this.lastDecisionTurn === undefined
                ? this.parameters.turn
                : this.lastDecisionTurn + 1;
              this.logger.warn(`Running ${this.playerConfig.strategist} on Turn ${this.parameters.turn}`, {
                GameID: this.parameters.gameID,
                PlayerID: this.parameters.playerID,
                scheduled,
                interrupted
              });

              const decided = await this.executeDecisionWithEventFallback(state, eventFromTurn, turnSpan);

              // Finalizing (the event cursor was already advanced after the refresh).
              // Only record a completed decision when one was actually made. If the
              // decision was abandoned because even the current turn alone exceeded the
              // model context, leave lastDecisionTurn untouched so this turn still counts
              // as scheduled next turn — we retry next turn rather than waiting until the
              // next paced decision point.
              if (decided) {
                this.lastDecisionTurn = this.parameters.turn;
              }

              // Recording the tokens and resume the game
              this.running = false;
              await this.context.callTool("resume-game", { PlayerID: this.playerID }, this.parameters);

              // Update the status
              turnSpan.setAttributes({
                'completed': true,
                'pacing.skipped': false,
                'pacing.decided': decided,
                'pacing.interrupted': interrupted,
                'tokens.input': this.context.inputTokens - startingInput,
                'tokens.reasoning': this.context.reasoningTokens - startingReasoning,
                'tokens.output': this.context.outputTokens - startingOutput
              });
              turnSpan.setStatus({ code: SpanStatusCode.OK });
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
   * Execute a strategist decision, narrowing the event window one turn at a
   * time when the model context is exceeded. Returns true once a decision is
   * made (including the no-op "none" strategist). If even the current turn alone
   * is too large, returns false so the caller can retry next turn instead of
   * recording a completed decision.
   */
  private async executeDecisionWithEventFallback(
    state: GameState,
    eventFromTurn: number,
    turnSpan: Span
  ): Promise<boolean> {
    const decided = await withEventWindowFallback(this.parameters, state, eventFromTurn, async (eventWindow) => {
      turnSpan.setAttributes({
        event_from: eventWindow.fromTurn,
        event_to: eventWindow.toTurn
      });

      // Without strategists, we just fake one.
      if (this.playerConfig.strategist == "none") {
        await setTimeout(2000);
        return true;
      }

      let contextLengthExceeded = false;
      await this.context.execute(this.playerConfig.strategist, this.parameters, undefined, undefined, undefined, () => {
        contextLengthExceeded = true;
      });

      if (!contextLengthExceeded) return true;

      this.logger.warn(
        `Context length exceeded on turn ${this.parameters.turn}; retrying with a narrower event window.`,
        {
          GameID: this.parameters.gameID,
          PlayerID: this.parameters.playerID,
          EventFrom: eventWindow.fromTurn,
          EventTo: eventWindow.toTurn
        }
      );
      return false;
    });

    if (!decided) {
      this.logger.warn(
        `Context length exceeded on turn ${this.parameters.turn}; abandoning the decision to retry next turn.`,
        {
          GameID: this.parameters.gameID,
          PlayerID: this.parameters.playerID
        }
      );
    }

    return decided;
  }
}
