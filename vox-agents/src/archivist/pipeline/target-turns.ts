/**
 * @module archivist/pipeline/target-turns
 *
 * Computes the set of turns that need telepathist summaries: landmark turns
 * plus their consequence turns at future horizons used by the reader pipeline.
 */

import { horizons, horizonTolerance } from '../types.js';

/** Per-worker statistics, merged at the end. */
export interface WorkerStats {
  processed: number;
  skipped: number;
  errors: number;
  gamesProcessed: number;
}

/**
 * Compute the set of turns that need summaries: landmark turns plus their
 * consequence turns (at +5/+10/+20/+30 horizons used by the reader's outcome pipeline).
 * Snaps consequence turns to nearby existing summaries within {@link horizonTolerance}
 * to avoid redundant LLM calls when a close-enough summary already exists.
 */
export function computeTargetTurns(
  landmarkTurns: number[],
  allTurns: Set<number>,
): { targetTurns: number[]; landmarkSet: Set<number> } {
  const landmarkSet = new Set(landmarkTurns);
  const targetSet = new Set(landmarkTurns);

  for (const lt of landmarkTurns) {
    for (const h of horizons) {
      const ideal = lt + h;

      // Already covered by an existing target at the exact turn
      if (targetSet.has(ideal)) continue;

      // Check if a nearby turn (within tolerance) is already covered
      let covered = false;
      for (let d = 1; d <= horizonTolerance; d++) {
        if (targetSet.has(ideal - d) || targetSet.has(ideal + d)) {
          covered = true;
          break;
        }
      }
      if (covered) continue;

      // Find the closest game turn within the tolerance window
      if (allTurns.has(ideal)) {
        targetSet.add(ideal);
      } else {
        for (let d = 1; d <= horizonTolerance; d++) {
          if (allTurns.has(ideal - d)) { targetSet.add(ideal - d); break; }
          if (allTurns.has(ideal + d)) { targetSet.add(ideal + d); break; }
        }
      }
    }
  }

  return {
    targetTurns: [...targetSet].sort((a, b) => a - b),
    landmarkSet,
  };
}
