/**
 * Mock-tier tests for the search-database tool.
 *
 * The tool fans out across a fixed set of database sub-tools (getTechnology,
 * getPolicy, ...), pulling cached summaries from each via getTool(...).getSummaries(),
 * runs a weighted fuzzy search per (keyword x tool), and fuses the resulting ranked
 * lists with Reciprocal Rank Fusion. There is no game DB at the mock tier, so we mock
 * `../index.js`'s getTool to hand back fake sub-tools whose getSummaries() returns
 * canned rows. The real weightedFuzzySearch + reciprocalRankFusion run unchanged.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// getTool is imported by search-database from ../index.js; mock that boundary.
vi.mock('../../../src/tools/index.js', () => ({
  getTool: vi.fn(),
}));

import { getTool } from '../../../src/tools/index.js';
import createSearchDatabaseTool from '../../../src/tools/general/search-database.js';

const tool = createSearchDatabaseTool();

/**
 * Build a row whose every weighted field is populated, so an exact Name match clears
 * the 0.6 weighted-search threshold (the score is normalized across the full field
 * weight set, so sparse rows never reach 0.6 even on an exact hit).
 */
function row(name: string, fillKeyword: string, extra: Record<string, unknown> = {}) {
  return {
    Name: name,
    Type: 'TYPE_' + name.toUpperCase(),
    Help: fillKeyword,
    Description: fillKeyword,
    Strategy: fillKeyword,
    Branch: fillKeyword,
    Era: fillKeyword,
    ...extra,
  };
}

/** A fake sub-tool exposing the getSummaries() contract search-database relies on. */
function fakeTool(summaries: Record<string, unknown>[]) {
  return { getSummaries: vi.fn().mockResolvedValue(summaries.map((s) => ({ ...s }))) };
}

/**
 * Wire getTool so only the named tools resolve to fake sub-tools; all others return
 * undefined (exercising the "tool not found" tolerance path).
 */
function wireTools(map: Record<string, ReturnType<typeof fakeTool> | undefined>) {
  (getTool as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (name: string) => map[name]
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('search-database', () => {
  it('ranks an exact fuzzy match first and clears the 0.6 weighted threshold', async () => {
    wireTools({
      getTechnology: fakeTool([
        row('Pottery', 'Pottery'),
        row('Archery', 'Pottery'), // shares the keyword in secondary fields -> lower score
        row('Writing', 'unrelated'), // below threshold, dropped
      ]),
    });

    const result = await tool.execute({ Keywords: ['Pottery'], MaxResults: 10 } as any);
    const keys = Object.keys(result);

    expect(keys).toEqual(['Technology: Pottery', 'Technology: Archery']);
    expect(keys).not.toContain('Technology: Writing');
    // Top result carries the highest relevance.
    expect(result['Technology: Pottery'].Relevance).toBeGreaterThan(
      result['Technology: Archery'].Relevance
    );
  });

  it('fuses across keywords so a row matched by multiple keywords outranks single-keyword hits', async () => {
    // Pottery is matched by both keywords (two ranked lists); Archery by one.
    wireTools({
      getTechnology: fakeTool([
        row('Pottery', 'Pottery Archery'),
        row('Archery', 'Archery'),
      ]),
    });

    const result = await tool.execute({
      Keywords: ['Pottery', 'Archery'],
      MaxResults: 10,
    } as any);
    const keys = Object.keys(result);

    expect(keys[0]).toBe('Technology: Pottery');
    expect(keys).toContain('Technology: Archery');
    expect(result['Technology: Pottery'].Relevance).toBeGreaterThan(
      result['Technology: Archery'].Relevance
    );
  });

  it('fuses across different tools into one unified ranking', async () => {
    wireTools({
      getTechnology: fakeTool([row('Pottery', 'Pottery')]),
      getPolicy: fakeTool([row('Tradition', 'Pottery')]),
    });

    const result = await tool.execute({ Keywords: ['Pottery'], MaxResults: 10 } as any);
    const keys = Object.keys(result);

    // One result from each tool, prefixed with the human-readable type name.
    expect(keys).toContain('Technology: Pottery');
    expect(keys).toContain('Policy: Tradition');
    expect(keys).toHaveLength(2);
  });

  it('honours MaxResults by truncating the fused list', async () => {
    wireTools({
      getTechnology: fakeTool([
        row('Pottery', 'Pottery'),
        row('Archery', 'Pottery'),
      ]),
    });

    const result = await tool.execute({ Keywords: ['Pottery'], MaxResults: 1 } as any);
    expect(Object.keys(result)).toEqual(['Technology: Pottery']);
  });

  it('preserves non-key fields and strips Type, attaching a numeric Relevance', async () => {
    wireTools({
      getTechnology: fakeTool([row('Pottery', 'Pottery', { Cost: 35, Era: 'Ancient' })]),
    });

    const result = await tool.execute({ Keywords: ['Pottery'], MaxResults: 10 } as any);
    const entry = result['Technology: Pottery'];

    expect(entry).toBeDefined();
    expect(entry.Name).toBe('Pottery');
    expect(entry.Cost).toBe(35);
    expect(entry.Era).toBe('Ancient');
    expect(typeof entry.Relevance).toBe('number');
    // Type is consumed to build the key and deleted from the payload.
    expect(entry).not.toHaveProperty('Type');
  });

  it('returns an empty object when no keywords match anything', async () => {
    wireTools({
      getTechnology: fakeTool([row('Pottery', 'Pottery')]),
    });

    const result = await tool.execute({ Keywords: ['zzzzzzzz'], MaxResults: 10 } as any);
    expect(result).toEqual({});
  });

  it('returns an empty object for an empty keyword list', async () => {
    wireTools({ getTechnology: fakeTool([row('Pottery', 'Pottery')]) });

    const result = await tool.execute({ Keywords: [], MaxResults: 10 } as any);
    expect(result).toEqual({});
  });

  it('tolerates tools that are missing or lack getSummaries', async () => {
    wireTools({
      getTechnology: fakeTool([row('Pottery', 'Pottery')]),
      // getPolicy etc. resolve to undefined; an object without getSummaries is also skipped.
      getBuilding: { notGetSummaries: true } as any,
    });

    const result = await tool.execute({ Keywords: ['Pottery'], MaxResults: 10 } as any);
    expect(Object.keys(result)).toEqual(['Technology: Pottery']);
  });

  it('tolerates a sub-tool whose getSummaries rejects, keeping other results', async () => {
    const failing = { getSummaries: vi.fn().mockRejectedValue(new Error('DB down')) };
    wireTools({
      getTechnology: fakeTool([row('Pottery', 'Pottery')]),
      getPolicy: failing as any,
    });

    const result = await tool.execute({ Keywords: ['Pottery'], MaxResults: 10 } as any);
    expect(failing.getSummaries).toHaveBeenCalled();
    expect(Object.keys(result)).toEqual(['Technology: Pottery']);
  });

  it('falls back to Type for the key name segment when Name is absent', async () => {
    // No Name field: the tool uses item.Type for the name segment, then deletes Type.
    const noName = {
      Type: 'Pottery',
      Help: 'Pottery',
      Description: 'Pottery',
      Strategy: 'Pottery',
      Branch: 'Pottery',
      Era: 'Pottery',
    };
    wireTools({ getTechnology: fakeTool([noName]) });

    const result = await tool.execute({ Keywords: ['Pottery'], MaxResults: 10 } as any);
    const keys = Object.keys(result);
    expect(keys).toEqual(['Technology: Pottery']);
    expect(result[keys[0]]).not.toHaveProperty('Type');
  });
});
