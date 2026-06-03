/**
 * @module strategist/pacing/types
 *
 * Shared contracts for strategist pacing interruption strategies.
 */

import type { GameState } from "../strategy-parameters.js";

/**
 * Inputs handed to a strategy when deciding whether to force an off-cadence decision.
 */
export interface PacingInterruptionContext {
  /** The current turn's cached game state to inspect (events, players, etc.). */
  state: GameState;
  /** The player the pacing decision is being made for. */
  playerID: number;
}

/**
 * Serializable metadata describing an interruption strategy, surfaced to the API/UI.
 */
export interface PacingInterruptionInfo {
  /** Registry key used in PlayerConfig.pacing.interruption. */
  name: string;
  /** Human-readable label for config UI controls. */
  label: string;
  /** Optional description of when the interruption fires. */
  description?: string;
}

/**
 * Strategy object that can force a strategist decision outside the normal turn cadence.
 */
export interface PacingInterruptionStrategy extends PacingInterruptionInfo {
  /** Return true to force a full strategist decision this turn. */
  shouldInterrupt(context: PacingInterruptionContext): boolean;
}
