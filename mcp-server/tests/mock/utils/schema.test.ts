/**
 * Tests for Zod schema-driven object key ordering.
 */
import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import { sortBySchema } from '../../../src/utils/schema.js';

describe('sortBySchema', () => {
  const schema = z.object({
    Name: z.string(),
    Score: z.number(),
    Era: z.string().optional(),
  });

  it('should order schema keys first, in schema definition order', () => {
    const data = { Score: 50, Name: 'Test', Era: 'Classical' };
    const sorted = sortBySchema(data, schema as any);
    expect(Object.keys(sorted)).toEqual(['Name', 'Score', 'Era']);
    expect(sorted).toEqual(data);
  });

  it('should append dynamic keys alphabetically after schema keys', () => {
    const data = { PlayerB: 200, Score: 50, PlayerA: 100, Name: 'Test' };
    const sorted = sortBySchema(data, schema as any);
    expect(Object.keys(sorted)).toEqual(['Name', 'Score', 'PlayerA', 'PlayerB']);
  });

  it('should skip schema keys missing from the data', () => {
    const data = { Score: 50, Zeta: 1 };
    const sorted = sortBySchema(data, schema as any);
    expect(Object.keys(sorted)).toEqual(['Score', 'Zeta']);
  });

  it('should return an empty object for empty data', () => {
    expect(sortBySchema({}, schema as any)).toEqual({});
  });

  it('should preserve all values', () => {
    const data = { Dyn: { nested: true }, Name: 'X', Score: 0 };
    const sorted = sortBySchema(data, schema as any);
    expect(sorted.Dyn).toBe(data.Dyn);
    expect(sorted.Score).toBe(0);
  });

  it('should return a new object without mutating the input', () => {
    const data = { Score: 50, Name: 'Test' };
    const sorted = sortBySchema(data, schema as any);
    expect(sorted).not.toBe(data);
    // Original insertion order must survive, since callers may reuse the input
    expect(Object.keys(data)).toEqual(['Score', 'Name']);
  });
});
