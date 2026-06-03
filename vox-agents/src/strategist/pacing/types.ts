/**
 * @module strategist/pacing/types
 *
 * Shared contracts for strategist pacing interruption strategies.
 */

import type { GameState } from "../strategy-parameters.js";
// Canonical, serializable metadata type lives in the shared types layer so the
// web API and UI consume the same shape. Re-exported here for strategist code.
import type { PacingInterruptionInfo } from "../../types/api.js";

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
 * Strategy object that can force a strategist decision outside the normal turn cadence.
 */
export interface PacingInterruptionStrategy extends PacingInterruptionInfo {
  /** Return true to force a full strategist decision this turn. */
  shouldInterrupt(context: PacingInterruptionContext): boolean;
}
