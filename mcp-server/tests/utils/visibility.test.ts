/**
 * Tests for player visibility utilities (bitfield array <-> per-player levels).
 */
import { describe, it, expect } from 'vitest';
import {
  applyVisibility,
  parseVisibility,
  getVisibility,
  getPlayerVisibility,
  composeVisibility,
} from '../../src/utils/knowledge/visibility.js';
import { MaxMajorCivs } from '../../src/knowledge/schema/base.js';

describe('composeVisibility', () => {
  it('should create an array of MaxMajorCivs entries', () => {
    expect(composeVisibility([])).toHaveLength(MaxMajorCivs);
  });

  it('should set level 2 for listed players and 0 for others', () => {
    const visibility = composeVisibility([0, 3]);
    expect(visibility[0]).toBe(2);
    expect(visibility[3]).toBe(2);
    expect(visibility[1]).toBe(0);
    expect(visibility[MaxMajorCivs - 1]).toBe(0);
  });

  it('should ignore out-of-range player IDs', () => {
    const visibility = composeVisibility([-1, MaxMajorCivs, MaxMajorCivs + 5]);
    expect(visibility.every(v => v === 0)).toBe(true);
  });

  it('should include the last valid player slot', () => {
    const visibility = composeVisibility([MaxMajorCivs - 1]);
    expect(visibility[MaxMajorCivs - 1]).toBe(2);
  });
});

describe('applyVisibility', () => {
  it('should return data unchanged when no visibility array is given', () => {
    const data = { Name: 'test' } as any;
    const result = applyVisibility(data);
    expect(result).toBe(data);
    expect(result.Player0).toBeUndefined();
  });

  it('should write PlayerN fields from the visibility array', () => {
    const data = { Name: 'test' } as any;
    const visibility = composeVisibility([1]);
    const result = applyVisibility(data, visibility) as any;
    expect(result.Player1).toBe(2);
    expect(result.Player0).toBe(0);
    expect(result[`Player${MaxMajorCivs - 1}`]).toBe(0);
  });
});

describe('parseVisibility', () => {
  it('should round-trip with applyVisibility/composeVisibility', () => {
    const visibility = composeVisibility([2, 5, 21]);
    const data = applyVisibility({} as any, visibility);
    expect(parseVisibility(data)).toEqual(visibility);
  });
});

describe('getVisibility', () => {
  it('should return the visibility level for a specific player', () => {
    const data = applyVisibility({} as any, composeVisibility([4]));
    expect(getVisibility(data, 4)).toBe(2);
    expect(getVisibility(data, 5)).toBe(0);
  });
});

describe('getPlayerVisibility', () => {
  /** Build a minimal PlayerSummary-like object keyed by player with visibility fields */
  function makeSummary(key: number, visibleTo: number[]): any {
    return applyVisibility({ Key: key } as any, composeVisibility(visibleTo));
  }

  it('should return 2 (full) when the viewing player is undefined', () => {
    expect(getPlayerVisibility([], undefined, 3)).toBe(2);
  });

  it('should return 2 when the target player is not found', () => {
    expect(getPlayerVisibility([makeSummary(1, [0])], 0, 99)).toBe(2);
  });

  it('should return the viewing player visibility of the target', () => {
    const summaries = [makeSummary(1, [0]), makeSummary(2, [])];
    expect(getPlayerVisibility(summaries, 0, 1)).toBe(2);
    expect(getPlayerVisibility(summaries, 0, 2)).toBe(0);
  });
});
