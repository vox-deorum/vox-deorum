/**
 * Tests for archivist pure numeric computation helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  clamp,
  normalizeShare,
  scaleShare,
  computeCityAdjustedShare,
  computeRawShare,
  computePerPop,
  computeGap,
  computeGapBidirectional,
  relativeDelta,
  relativePerPopDelta,
  formatDelta,
} from '../../src/archivist/utils/math.js';

describe('clamp', () => {
  it('should clamp to the inclusive [min, max] range', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(7, 0, 1)).toBe(1);
  });
});

describe('normalizeShare', () => {
  it('should return 0.5 for null (unknown share)', () => {
    expect(normalizeShare(null)).toBe(0.5);
  });

  it('should map the fair-share value 1.0 into [0, 1]', () => {
    expect(normalizeShare(1.0)).toBeCloseTo((1.0 - 0.25) / 3.75);
  });

  it('should clamp at the lower bound (0.25 of fair share)', () => {
    expect(normalizeShare(0.1)).toBe(0);
    expect(normalizeShare(0.25)).toBe(0);
  });

  it('should clamp at the upper bound (4.0 of fair share)', () => {
    expect(normalizeShare(10)).toBe(1);
    expect(normalizeShare(4.0)).toBe(1);
  });
});

describe('scaleShare', () => {
  it('should return null for null shares', () => {
    expect(scaleShare(null, 2)).toBeNull();
  });

  it('should multiply the share by the scale', () => {
    expect(scaleShare(0.5, 2)).toBe(1.0);
  });
});

describe('computeCityAdjustedShare', () => {
  it('should return null when player value or cities is null', () => {
    expect(computeCityAdjustedShare(null, 1, [])).toBeNull();
    expect(computeCityAdjustedShare(100, null, [])).toBeNull();
  });

  it('should split evenly for identical players', () => {
    const all = [
      { value: 100, cities: 1 },
      { value: 100, cities: 1 },
    ];
    expect(computeCityAdjustedShare(100, 1, all)).toBeCloseTo(0.5);
  });

  it('should use a multiplier of 1.0 for single-city players', () => {
    // cities=1 -> max(1.05 * 0, 1.0) = 1.0, so adjusted value equals raw value
    const all = [
      { value: 100, cities: 1 },
      { value: 300, cities: 1 },
    ];
    expect(computeCityAdjustedShare(100, 1, all)).toBeCloseTo(0.25);
  });

  it('should penalize wide empires via the city multiplier', () => {
    // cities=3 -> multiplier 2.1, so 210 production counts as 100 adjusted
    const all = [
      { value: 210, cities: 3 },
      { value: 100, cities: 1 },
    ];
    expect(computeCityAdjustedShare(210, 3, all)).toBeCloseTo(0.5);
  });

  it('should skip players with null data in the total', () => {
    const all = [
      { value: 100, cities: 1 },
      { value: null, cities: 1 },
      { value: 100, cities: null },
      { value: 100, cities: 1 },
    ];
    expect(computeCityAdjustedShare(100, 1, all)).toBeCloseTo(0.5);
  });

  it('should return null when the adjusted total is zero', () => {
    expect(computeCityAdjustedShare(0, 1, [{ value: 0, cities: 1 }])).toBeNull();
  });
});

describe('computeRawShare', () => {
  it('should return null for a null player value', () => {
    expect(computeRawShare(null, [100])).toBeNull();
  });

  it('should compute a simple ratio over non-null values', () => {
    expect(computeRawShare(25, [25, null, 75])).toBeCloseTo(0.25);
  });

  it('should return null when the total is zero', () => {
    expect(computeRawShare(0, [0, 0])).toBeNull();
    expect(computeRawShare(5, [])).toBeNull();
  });
});

describe('computePerPop', () => {
  it('should return null for null inputs or zero population', () => {
    expect(computePerPop(null, 10)).toBeNull();
    expect(computePerPop(10, null)).toBeNull();
    expect(computePerPop(10, 0)).toBeNull();
  });

  it('should divide metric by population', () => {
    expect(computePerPop(30, 10)).toBeCloseTo(3);
  });
});

describe('computeGap', () => {
  it('should return 0 for a null player value', () => {
    expect(computeGap(null, [10, 20])).toBe(0);
  });

  it('should return 0 when the player is the leader', () => {
    expect(computeGap(20, [10, 20, 5])).toBe(0);
  });

  it('should return a negative gap for trailing players', () => {
    expect(computeGap(10, [10, 25, 5])).toBe(-15);
  });

  it('should return 0 when no other values exist', () => {
    expect(computeGap(10, [null, null])).toBe(0);
    expect(computeGap(10, [])).toBe(0);
  });
});

describe('computeGapBidirectional', () => {
  it('should return 0 for a null player value', () => {
    expect(computeGapBidirectional(null, [10])).toBe(0);
  });

  it('should be negative when leading the best other player', () => {
    expect(computeGapBidirectional(30, [10, 20])).toBe(-10);
  });

  it('should be positive when behind the best other player', () => {
    expect(computeGapBidirectional(10, [10, 25])).toBe(15);
  });

  it('should return 0 with no comparable values', () => {
    expect(computeGapBidirectional(10, [null])).toBe(0);
    expect(computeGapBidirectional(10, [])).toBe(0);
  });
});

describe('relativeDelta', () => {
  it('should return null for null or zero base', () => {
    expect(relativeDelta(null, 10)).toBeNull();
    expect(relativeDelta(10, null)).toBeNull();
    expect(relativeDelta(0, 10)).toBeNull();
  });

  it('should compute (future - base) / base', () => {
    expect(relativeDelta(100, 150)).toBeCloseTo(0.5);
    expect(relativeDelta(100, 50)).toBeCloseTo(-0.5);
  });
});

describe('relativePerPopDelta', () => {
  it('should return null for null inputs', () => {
    expect(relativePerPopDelta(null, 1)).toBeNull();
    expect(relativePerPopDelta(1, null)).toBeNull();
  });

  it('should clamp the denominator to at least 1', () => {
    // base 0.5 would double the delta; clamped to 1 instead
    expect(relativePerPopDelta(0.5, 1.5)).toBeCloseTo(1.0);
    expect(relativePerPopDelta(0, 2)).toBeCloseTo(2);
  });

  it('should behave like relativeDelta for base >= 1', () => {
    expect(relativePerPopDelta(2, 3)).toBeCloseTo(0.5);
  });
});

describe('formatDelta', () => {
  it('should return null for null deltas', () => {
    expect(formatDelta(null)).toBeNull();
  });

  it('should format positive deltas with a plus sign', () => {
    expect(formatDelta(0.156)).toBe('+16%');
  });

  it('should format negative deltas with a minus sign', () => {
    expect(formatDelta(-0.5)).toBe('-50%');
  });

  it('should format zero as 0%', () => {
    expect(formatDelta(0)).toBe('0%');
  });

  it('should round tiny non-zero deltas to signed 0%', () => {
    expect(formatDelta(0.001)).toBe('+0%');
    expect(formatDelta(-0.001)).toBe('-0%');
  });
});
