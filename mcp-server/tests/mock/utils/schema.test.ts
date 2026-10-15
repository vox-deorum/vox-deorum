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

  it('orders schema keys first while preserving the corresponding values', () => {
    const data = { Dyn: { nested: true }, Score: 0, Name: 'Test', Era: 'Classical' };
    const sorted = sortBySchema(data, schema as any);
    expect(Object.keys(sorted)).toEqual(['Name', 'Score', 'Era', 'Dyn']);
    expect(sorted).toEqual(data);
    expect(sorted.Dyn).toEqual({ nested: true });
    expect(sorted.Score).toBe(0);
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

  it('preserves the caller input and its insertion order', () => {
    const data = { Score: 50, Name: 'Test' };
    const sorted = sortBySchema(data, schema as any);
    expect(sorted).toEqual({ Name: 'Test', Score: 50 });
    expect(data).toEqual({ Score: 50, Name: 'Test' });
    expect(Object.keys(data)).toEqual(['Score', 'Name']);
  });
});
