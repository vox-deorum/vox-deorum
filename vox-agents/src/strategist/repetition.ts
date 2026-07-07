/**
 * @module strategist/repetition
 *
 * Shared repetition-policy resolution for strategist sessions. Both the console entry point and
 * the web `/api/session/start` route derive their run count from a session config the same way,
 * so the rule lives here once instead of being copy-pasted (and silently diverging) at each entry
 * point. Kept out of `loop.ts` so it stays importable when the loop module is mocked in tests.
 */

import { createLogger } from '../utils/logger.js';
import type { StrategistSessionConfig } from '../types/config.js';

const logger = createLogger('strategist-repetition');

/**
 * Resolve the repetition cap and cycle flags for a strategist session from its config.
 *
 * `repetition: "auto"` means "run until the seating × seed cycle completes" — only meaningful when
 * a cycle is actually enabled (randomized seating, or a multi-entry `randomSeeds`); otherwise it
 * falls back to a single run and warns. A numeric `repetition` is honored verbatim; anything else
 * is a single run.
 */
export function resolveMaxRepetitions(config: StrategistSessionConfig): {
  maxRepetitions: number;
  cycleEnabled: boolean;
  isAutoRepetition: boolean;
} {
  const isAutoRepetition = config.repetition === 'auto';
  // `randomizeSeating: 0` is a valid seed (truthy-as-seed), not "disabled".
  const seatingEnabled =
    config.randomizeSeating !== undefined && config.randomizeSeating !== false;
  const cycleEnabled =
    seatingEnabled ||
    (Array.isArray(config.randomSeeds) && config.randomSeeds.length > 1);
  if (isAutoRepetition && !cycleEnabled) {
    logger.warn(`repetition: "auto" requires randomizeSeating or a multi-entry randomSeeds; falling back to 1 run`);
  }
  const maxRepetitions = isAutoRepetition
    ? (cycleEnabled ? Number.POSITIVE_INFINITY : 1)
    : (typeof config.repetition === 'number' ? config.repetition : 1);
  return { maxRepetitions, cycleEnabled, isAutoRepetition };
}
