/**
 * @module strategist/pacing/none
 */

import type { PacingInterruptionContext, PacingInterruptionStrategy } from "./types.js";

/**
 * Default interruption strategy: pacing is controlled only by the scheduled cadence.
 */
export class NonePacingInterruption implements PacingInterruptionStrategy {
  readonly name = "none";
  readonly label = "None";
  readonly description = "Never force off-cadence strategist decisions.";

  shouldInterrupt(_context: PacingInterruptionContext): boolean {
    return false;
  }
}
