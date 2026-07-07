/**
 * @module archivist/utils/math
 *
 * Pure numeric computation helpers used across the archivist pipeline.
 * Includes share computation, gap/per-pop metrics, delta calculations, and formatting.
 */

/** Clamp a value to a [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Normalize a relative-to-fair-share value for vector embedding.
 * Shares are already regularized (1.0 = average player).
 * Clamps to [0.25, 4.0] (25%–400% of fair share) and maps to [0, 1].
 */
export function normalizeShare(share: number | null): number {
  if (share == null) return 0.5;
  return (clamp(share, 0.25, 4.0) - 0.25) / 3.75;
}

/** Scale a share value when only partial players are known. */
export function scaleShare(share: number | null, scale: number): number | null {
  if (share == null) return null;
  return share * scale;
}

/**
 * Compute a city-adjusted share for a yield metric.
 * cityMultiplier = max(1.05 * (cities - 1), 1.0)
 * adj = value / multiplier
 * share = playerAdj / sum(allAdj)
 */
export function computeCityAdjustedShare(
  playerValue: number | null,
  playerCities: number | null,
  allPlayerData: Array<{ value: number | null; cities: number | null }>
): number | null {
  if (playerValue == null || playerCities == null) return null;

  const playerMultiplier = Math.max(1.05 * (playerCities - 1), 1.0);
  const playerAdj = playerValue / playerMultiplier;

  let totalAdj = 0;
  for (const p of allPlayerData) {
    if (p.value == null || p.cities == null) continue;
    const mult = Math.max(1.05 * (p.cities - 1), 1.0);
    totalAdj += p.value / mult;
  }

  return totalAdj > 0 ? playerAdj / totalAdj : null;
}

/**
 * Compute a raw share (simple ratio).
 * share = playerValue / sum(allValues)
 */
export function computeRawShare(
  playerValue: number | null,
  allValues: (number | null)[]
): number | null {
  if (playerValue == null) return null;
  let total = 0;
  for (const v of allValues) {
    if (v != null) total += v;
  }
  return total > 0 ? playerValue / total : null;
}

/** Compute raw per-population ratio (not scaled). */
export function computePerPop(
  metric: number | null,
  population: number | null
): number | null {
  if (metric == null || population == null || population === 0) return null;
  return metric / population;
}

/**
 * Compute bidirectional gap against the best OTHER player.
 * Returns bestOtherValue - playerValue.
 * Negative when leading, positive when behind, 0 when tied or no data.
 * Caller must exclude the current player from otherValues.
 */
export function computeGapBidirectional(
  playerValue: number | null,
  otherValues: (number | null)[]
): number {
  if (playerValue == null) return 0;
  let bestOther = -Infinity;
  for (const v of otherValues) {
    if (v != null && v > bestOther) bestOther = v;
  }
  return bestOther === -Infinity ? 0 : bestOther - playerValue;
}

/** Compute relative delta: (future - base) / base, or null if base is zero/null. */
export function relativeDelta(base: number | null, future: number | null): number | null {
  if (base == null || future == null || base === 0) return null;
  return (future - base) / base;
}

/** Like relativeDelta but clamps base to at least 1 for per-pop metrics. */
export function relativePerPopDelta(base: number | null, future: number | null): number | null {
  if (base == null || future == null) return null;
  return (future - base) / Math.max(base, 1);
}

/** Format a numeric delta as a human-readable percentage string. */
export function formatDelta(delta: number | null): string | null {
  if (delta == null) return null;
  const pct = Math.round(Math.abs(delta * 100));
  if (delta > 0) return `+${pct}%`;
  if (delta < 0) return `-${pct}%`;
  return '0%';
}
