/**
 * Mock-tier tests for the DatabaseQueryTool abstraction.
 *
 * DatabaseQueryTool is abstract: subclasses supply fetchSummaries / fetchFullInfo and
 * the schemas, while the base provides the search + cache + single-result-expansion +
 * localization contract. The mock tier has no game DB, so we drive a tiny concrete
 * subclass with in-memory fixtures and stub the one external boundary the base touches:
 * gameDatabase.localizeObjects (which otherwise throws without a localization DB). The
 * fuzzy search (fast-fuzzy) runs for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as z from 'zod';
import { gameDatabase } from '../../../../src/server.js';
import { DatabaseQueryTool } from '../../../../src/tools/abstract/database-query.js';

const ItemSchema = z.object({
  Type: z.string(),
  Name: z.string(),
  Era: z.string().optional(),
  Help: z.string().optional(),
});
type Item = z.infer<typeof ItemSchema>;

const FullSchema = ItemSchema.extend({ Detail: z.string() });
type Full = z.infer<typeof FullSchema>;

/** Minimal concrete subclass exposing the base contract over injected fixtures. */
class TestQueryTool extends DatabaseQueryTool<Item, Full> {
  readonly name = 'test-query';
  readonly description = 'test';
  protected readonly summarySchema = ItemSchema as unknown as z.ZodSchema<Item>;
  protected readonly fullSchema = FullSchema as unknown as z.ZodSchema<Full>;

  public summaries: Item[];
  public fetchSummariesCalls = 0;
  public fullInfoCalls: string[] = [];

  constructor(summaries: Item[]) {
    super();
    this.summaries = summaries;
  }

  protected async fetchSummaries(): Promise<Item[]> {
    this.fetchSummariesCalls++;
    return this.summaries;
  }

  protected async fetchFullInfo(identifier: string): Promise<Full> {
    this.fullInfoCalls.push(identifier);
    const item = this.summaries.find((s) => s.Type === identifier);
    if (!item) throw new Error(`not found: ${identifier}`);
    return { ...item, Detail: `detail-for-${item.Type}` };
  }
}

const FIXTURES: Item[] = [
  { Type: 'TECH_POTTERY', Name: 'Pottery', Era: 'Ancient', Help: 'Unlocks granary' },
  { Type: 'TECH_ARCHERY', Name: 'Archery', Era: 'Ancient', Help: 'Unlocks archers' },
  { Type: 'TECH_WRITING', Name: 'Writing', Era: 'Ancient', Help: 'Unlocks library' },
];

let localizeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Stub the only external dependency: localization is a pass-through here.
  localizeSpy = vi
    .spyOn(gameDatabase, 'localizeObjects')
    .mockImplementation(async (rows: any) => rows);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DatabaseQueryTool', () => {
  it('returns all summaries when no search term is given', async () => {
    const tool = new TestQueryTool(FIXTURES);
    const result = await tool.execute({ MaxResults: 20 } as any);

    expect(result.Count).toBe(3);
    expect(result.Items.map((i: any) => i.Name).sort()).toEqual([
      'Archery',
      'Pottery',
      'Writing',
    ]);
    expect(result.Error).toBeUndefined();
  });

  it('caches summaries: fetchSummaries runs once across repeated getSummaries calls', async () => {
    const tool = new TestQueryTool(FIXTURES);
    await tool.getSummaries();
    await tool.getSummaries();
    await tool.execute({ MaxResults: 20 } as any);

    expect(tool.fetchSummariesCalls).toBe(1);
  });

  it('fuzzy-filters by search term', async () => {
    const tool = new TestQueryTool(FIXTURES);
    const result = await tool.execute({ Search: 'Archery', MaxResults: 20 } as any);

    // A unique exact match collapses to a single result and is expanded to full info.
    expect(result.Count).toBe(1);
    expect(result.Items[0].Type).toBe('TECH_ARCHERY');
  });

  it('expands a single result via fetchFullInfo', async () => {
    const tool = new TestQueryTool(FIXTURES);
    const result = await tool.execute({ Search: 'Pottery', MaxResults: 20 } as any);

    expect(tool.fullInfoCalls).toEqual(['TECH_POTTERY']);
    expect(result.Count).toBe(1);
    expect(result.Items[0].Detail).toBe('detail-for-TECH_POTTERY');
  });

  it('does NOT expand to full info when more than one result remains', async () => {
    // "Ancient" matches the shared Era of every row -> multiple results, no expansion.
    const tool = new TestQueryTool(FIXTURES);
    const result = await tool.execute({ Search: 'Ancient', MaxResults: 20 } as any);

    expect(result.Count).toBeGreaterThan(1);
    expect(tool.fullInfoCalls).toEqual([]);
    expect(result.Items[0]).not.toHaveProperty('Detail');
  });

  it('limits results with MaxResults before single-result expansion', async () => {
    const tool = new TestQueryTool(FIXTURES);
    // No search -> all three, capped to 2; cap > 1 so no full-info expansion.
    const result = await tool.execute({ MaxResults: 2 } as any);

    expect(result.Count).toBe(2);
    expect(tool.fullInfoCalls).toEqual([]);
  });

  it('falls back to the summary when fetchFullInfo throws', async () => {
    const tool = new TestQueryTool(FIXTURES);
    vi.spyOn(tool as any, 'fetchFullInfo').mockRejectedValue(new Error('boom'));

    const result = await tool.execute({ Search: 'Pottery', MaxResults: 20 } as any);
    expect(result.Count).toBe(1);
    expect(result.Items[0].Type).toBe('TECH_POTTERY');
    expect(result.Items[0]).not.toHaveProperty('Detail');
  });

  it('localizes the returned items through gameDatabase.localizeObjects', async () => {
    const tool = new TestQueryTool(FIXTURES);
    await tool.execute({ Search: 'Pottery', MaxResults: 20 } as any);

    // Called for the result set (getSummaries also localizes the cache).
    expect(localizeSpy).toHaveBeenCalled();
  });

  it('returns an Error result when fetchSummaries throws', async () => {
    const tool = new TestQueryTool(FIXTURES);
    vi.spyOn(tool as any, 'fetchSummaries').mockRejectedValue(new Error('db offline'));

    const result = await tool.execute({ MaxResults: 20 } as any);
    expect(result.Count).toBe(0);
    expect(result.Items).toEqual([]);
    expect(result.Error).toBe('db offline');
  });

  it('honours a custom identifier field via getIdentifierField override', async () => {
    class NameKeyedTool extends TestQueryTool {
      protected getIdentifierField() {
        return 'Name' as keyof Item;
      }
      protected async fetchFullInfo(identifier: string): Promise<Full> {
        this.fullInfoCalls.push(identifier);
        const item = this.summaries.find((s) => s.Name === identifier)!;
        return { ...item, Detail: `by-name-${identifier}` };
      }
    }
    const tool = new NameKeyedTool(FIXTURES);
    const result = await tool.execute({ Search: 'Writing', MaxResults: 20 } as any);

    expect(tool.fullInfoCalls).toEqual(['Writing']);
    expect(result.Items[0].Detail).toBe('by-name-Writing');
  });
});
