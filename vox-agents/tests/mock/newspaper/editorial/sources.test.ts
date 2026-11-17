/** Verify the stable source deduplication shared by detectors and diplomacy. */
import { describe, expect, it } from 'vitest';
import type { NewspaperSourceReference } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { uniqueSources } from '../../../../src/newspaper/editorial/shared/sources.js';

/** Build a recorded source reference with controlled identity and date. */
function source(overrides: Partial<NewspaperSourceReference> = {}): NewspaperSourceReference {
  return { table: 'PlayerSummaries', id: 1, turn: 5, createdAt: 100, ...overrides };
}

describe('editorial source deduplication', () => {
  it('should keep references from different tables that share an ID', () => {
    const playerRow = source({ id: 7 });
    const cityRow = source({ table: 'CityInformations', id: 7 });
    expect(uniqueSources([playerRow, cityRow])).toEqual([playerRow, cityRow]);
  });

  it('should retain first-key insertion order', () => {
    const repeated = source({ id: 2, turn: 9 });
    const middle = source({ id: 1, turn: 1 });
    const replacement = source({ id: 2, turn: 10, createdAt: 200 });
    const result = uniqueSources([repeated, middle, replacement]);
    expect(result.map((entry) => `${entry.table}/${entry.id}`)).toEqual([
      'PlayerSummaries/2',
      'PlayerSummaries/1',
    ]);
    expect(result[0]).toBe(replacement);
  });

  it('should keep the last object supplied for a repeated identity', () => {
    const first = source({ id: 4, createdAt: 100 });
    const last = source({ id: 4, createdAt: 200 });
    const result = uniqueSources([first, last]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(last);
  });
});
