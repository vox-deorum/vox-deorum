/**
 * @module utils/random
 *
 * Generic seeded-PRNG helpers. Reuses `seedrandom` (already a dependency, see
 * utils/game/seating/cycle.ts) so a string seed key deterministically maps to a
 * value: identical keys always yield the same result, while distinct keys
 * decorrelate. Pure and framework-agnostic — the *source* of a seed key is the
 * caller's concern.
 */

import seedrandom from 'seedrandom';

/**
 * Deterministic index into `[0, length)` derived from a string seed key.
 * Identical keys always yield the same index; distinct keys decorrelate.
 * Returns `0` for a non-positive `length`.
 */
export function seededIndex(seedKey: string, length: number): number {
  if (length <= 0) return 0;
  const rng = seedrandom(seedKey);
  return Math.floor(rng() * length);
}
