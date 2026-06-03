/**
 * @module strategist/pacing
 *
 * Turn pacing helpers for strategist players.
 */

import type { GameState } from "./strategy-parameters.js";
import type { PacingConfig, PacingInterruption } from "../types/config.js";
import { pacingInterruptionRegistry } from "./pacing/registry.js";

/**
 * A fully-resolved pacing config with every field present, produced by
 * {@link normalizePacing}. Downstream code can read these fields without
 * guarding for undefined or invalid values.
 */
export interface NormalizedPacingConfig {
  /** Minimum number of turns between scheduled strategist decisions (>= 1). */
  everyTurns: number;
  /** Registered interruption strategy name; "none" disables off-cadence decisions. */
  interruption: PacingInterruption;
}

/** Defaults applied when a player omits pacing: decide every turn, no interruption. */
export const DEFAULT_PACING: NormalizedPacingConfig = {
  everyTurns: 1,
  interruption: "none",
};

/**
 * Fill missing pacing config with defaults and fall unknown interruption names
 * back to "none" so typoed configs do not crash the game loop.
 */
export function normalizePacing(config?: PacingConfig): NormalizedPacingConfig {
  const everyTurns = config?.everyTurns;
  const interruption = config?.interruption ?? DEFAULT_PACING.interruption;

  return {
    everyTurns: Number.isInteger(everyTurns) && everyTurns! > 0
      ? everyTurns!
      : DEFAULT_PACING.everyTurns,
    interruption: pacingInterruptionRegistry.has(interruption)
      ? interruption
      : DEFAULT_PACING.interruption,
  };
}

/**
 * Decide whether the normal cadence requires a strategist decision this turn.
 */
export function isScheduledDecision(
  currentTurn: number,
  lastDecisionTurn: number | undefined,
  pacing: NormalizedPacingConfig
): boolean {
  return lastDecisionTurn === undefined || currentTurn - lastDecisionTurn >= pacing.everyTurns;
}

/**
 * Delegate off-cadence decision checks to the configured interruption strategy.
 */
export function shouldInterruptDecision(
  state: GameState,
  playerID: number,
  pacing: NormalizedPacingConfig
): boolean {
  const strategy = pacingInterruptionRegistry.get(pacing.interruption)
    ?? pacingInterruptionRegistry.get(DEFAULT_PACING.interruption);
  return strategy?.shouldInterrupt({ state, playerID }) ?? false;
}
