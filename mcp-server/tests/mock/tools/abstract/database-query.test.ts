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
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DB } from '../../../../src/database/database.js';
import { bridgeManager, gameDatabase } from '../../../../src/server.js';
import { DatabaseQueryTool } from '../../../../src/tools/abstract/database-query.js';
import type { TooltipKind } from '../../../../src/utils/database/game-tooltips.js';


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

  it('returns an Error result when any fetchFullInfo fails in detailed mode', async () => {
    const tool = new TestQueryTool(FIXTURES);
    const fetchFullInfo = (tool as any).fetchFullInfo.bind(tool);
    vi.spyOn(tool as any, 'fetchFullInfo').mockImplementation(async (identifier: any) => {
      if (identifier === 'TECH_ARCHERY') throw new Error('boom');
      return fetchFullInfo(identifier);
    });

    const result = await tool.execute({ MaxResults: 20, Detailed: true } as any);
    expect(result.Count).toBe(0);
    expect(result.Items).toEqual([]);
    expect(result.Error).toBe('boom');
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

  describe('detailed listings and game tooltips', () => {
    /** A tool whose full reports carry the game's technology tooltip, with policy-style help cleanup. */
    class TooltipTool extends TestQueryTool {
      protected readonly tooltipKind: TooltipKind = 'technology';
      protected formatItem(item: Item): Item {
        return { ...item, Help: item.Help?.replace(/^Tip for /, '') };
      }
    }

    let db: Kysely<DB>;

    beforeEach(() => {
      // Icon names come from the yield and resource tables; a later yield reusing an icon must not rename it.
      const sqlite = new Database(':memory:');
      sqlite.exec(`
        CREATE TABLE Yields (ID INTEGER, IconString TEXT, Description TEXT);
        CREATE TABLE Resources (ID INTEGER, IconString TEXT, Description TEXT);
        INSERT INTO Yields VALUES (0, '[ICON_PRODUCTION]', 'Production'), (1, '[ICON_GOLD]', 'Gold'),
          (2, '[ICON_PEACE]', 'Faith'), (3, '[ICON_GOLDEN_AGE]', 'Golden Age Points'), (9, '[ICON_GOLD]', 'Loot');
        INSERT INTO Resources VALUES (0, '[ICON_RES_IRON]', 'Iron'), (1, '[ICON_RES_HORSE]', 'Horses');
      `);
      db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
      vi.spyOn(gameDatabase, 'getDatabase').mockReturnValue(db);
    });

    afterEach(async () => {
      await db.destroy();
    });

    /** Answer tooltip calls with a tooltip for every type except the ones listed. */
    function answerTooltips(missing: string[] = []) {
      return vi.spyOn(bridgeManager, 'callLuaFunction').mockImplementation(async (_name, args) => {
        const types = args[1] as string[];
        const result = Object.fromEntries(types.filter((type) => !missing.includes(type))
          .map((type) => [type, `Tip for ${type}[NEWLINE][ICON_BULLET]Detail`]));
        return { success: true, result };
      });
    }

    it('should expand every result to full information in detailed mode', async () => {
      const tool = new TestQueryTool(FIXTURES);
      const result = await tool.execute({ MaxResults: 20, Detailed: true } as any);

      expect(result.Count).toBe(3);
      expect(tool.fullInfoCalls.sort()).toEqual(['TECH_ARCHERY', 'TECH_POTTERY', 'TECH_WRITING']);
      expect(result.Items.every((item: any) => item.Detail)).toBe(true);
    });

    it('should replace help with stripped game tooltips fetched in batches', async () => {
      const many = Array.from({ length: 60 }, (_, index) => ({ Type: `TECH_${index}`, Name: `Tech ${index}`, Help: 'Database help' }));
      const call = answerTooltips(['TECH_7']);
      const tool = new TooltipTool(many);

      const result = await tool.execute({ MaxResults: 100, Detailed: true } as any);

      expect(call).toHaveBeenCalledTimes(2);
      expect(call.mock.calls.every(([name, args]) => name === 'VoxDeorumReferenceTooltips' && args[0] === 'technology')).toBe(true);
      const byType = new Map(result.Items.map((item: any) => [item.Type, item.Help]));
      expect(byType.get('TECH_0')).toBe('TECH_0\n* Detail');
      expect(byType.get('TECH_7')).toBe('Database help');
    });

    it('should name yield and resource icons that the text does not already name', async () => {
      vi.spyOn(bridgeManager, 'callLuaFunction').mockResolvedValue({ success: true, result: {
        TECH_POTTERY: '[ICON_RES_IRON] Iron: +1 [ICON_PRODUCTION] +1 [ICON_GOLD][NEWLINE][ICON_PEACE] Faith from [ICON_RES_HORSE] Horse',
        TECH_ARCHERY: '+2 [ICON_GOLDEN_AGE] Golden Age, +1 [ICON_GOLD] Golden Age Points, [ICON_CAPITAL] Capital',
      } });
      const tool = new TooltipTool(FIXTURES);

      const result = await tool.execute({ MaxResults: 20, Detailed: true } as any);

      const byType = new Map(result.Items.map((item: any) => [item.Type, item.Help]));
      expect(byType.get('TECH_POTTERY')).toBe('Iron: +1 Production +1 Gold\nFaith from Horse');
      expect(byType.get('TECH_ARCHERY')).toBe('+2 Golden Age, +1 Gold Golden Age Points, Capital');
    });

    it('should leave cached summaries unchanged', async () => {
      answerTooltips();
      const tool = new TooltipTool(FIXTURES);

      await tool.execute({ MaxResults: 20, Detailed: true } as any);

      expect((await tool.getSummaries()).map((item) => item.Help)).toEqual(FIXTURES.map((item) => item.Help));
    });

    it('should ask the game to register the tooltip function once it is missing, then retry', async () => {
      let registered = false;
      const script = vi.spyOn(bridgeManager, 'executeLuaScript').mockImplementation(async () => {
        registered = true;
        return { success: true, result: true } as any;
      });
      const call = vi.spyOn(bridgeManager, 'callLuaFunction').mockImplementation(async (_name, args) => registered
        ? { success: true, result: Object.fromEntries((args[1] as string[]).map((type) => [type, `Tip for ${type}`])) }
        : { success: false, error: { code: 'INVALID_FUNCTION', message: 'not found' } } as any);
      const tool = new TooltipTool(FIXTURES);

      const result = await tool.execute({ MaxResults: 20, Detailed: true } as any);

      expect(script).toHaveBeenCalledTimes(1);
      expect(call).toHaveBeenCalledTimes(2);
      expect(result.Error).toBeUndefined();
      expect(result.Items.every((item: any) => item.Help === item.Type)).toBe(true);
    });

    it('should report an error in detailed mode when the function stays unregistered', async () => {
      const script = vi.spyOn(bridgeManager, 'executeLuaScript').mockResolvedValue({ success: true, result: true } as any);
      const call = vi.spyOn(bridgeManager, 'callLuaFunction').mockResolvedValue({
        success: false, error: { code: 'INVALID_FUNCTION', message: 'not found' },
      } as any);
      const tool = new TooltipTool(FIXTURES);

      const result = await tool.execute({ MaxResults: 20, Detailed: true } as any);

      expect(script).toHaveBeenCalledTimes(1);
      expect(call).toHaveBeenCalledTimes(2);
      expect(result.Count).toBe(0);
      expect(result.Error).toMatch(/VoxDeorumReferenceTooltips/);
    });

    it('should keep the database text for a single match when tooltips fail', async () => {
      vi.spyOn(bridgeManager, 'callLuaFunction').mockResolvedValue({
        success: false, error: { code: 'DLL_DISCONNECTED', message: 'down' },
      } as any);
      const tool = new TooltipTool(FIXTURES);

      const result = await tool.execute({ Search: 'Pottery', MaxResults: 20 } as any);

      expect(result.Error).toBeUndefined();
      expect(result.Items[0]).toMatchObject({ Type: 'TECH_POTTERY', Help: 'Unlocks granary', Detail: 'detail-for-TECH_POTTERY' });
    });
  });
});
