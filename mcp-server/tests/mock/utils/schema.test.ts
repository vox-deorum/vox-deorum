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

  it('should order schema keys first, in schema definition order, and preserve all values', () => {
    const data = { Dyn: { nested: true }, Score: 0, Name: 'Test', Era: 'Classical' };
    const sorted = sortBySchema(data, schema as any);
    expect(Object.keys(sorted)).toEqual(['Name', 'Score', 'Era', 'Dyn']);
    expect(sorted).toEqual(data);
    // Values carry through by identity, including nested and falsy ones.
    expect(sorted.Dyn).toBe(data.Dyn);
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

  it('should return a new object without mutating the input', () => {
    const data = { Score: 50, Name: 'Test' };
    const sorted = sortBySchema(data, schema as any);
    expect(sorted).not.toBe(data);
    // Original insertion order must survive, since callers may reuse the input
    expect(Object.keys(data)).toEqual(['Score', 'Name']);
  });
});
