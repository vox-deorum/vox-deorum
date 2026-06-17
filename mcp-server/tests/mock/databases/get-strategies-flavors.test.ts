/**
 * Mock-tier tests for the strategy/flavor DB-lookup tools:
 *   - get-economic-strategies / get-military-strategies (AiStrategyTool)
 *   - get-flavors (DatabaseQueryTool over the flavors JSON)
 *
 * The mock tier has no game DB, so the raw DB read is stubbed at the boundary:
 *   - For the strategy tools, fetchSummaries() (which would call
 *     gameDatabase.getDatabase() + Kysely + writeJsonIfChanged) is spied to return
 *     canned strategy rows. This still exercises the real search / single-result
 *     expansion / localize / output-shaping path of the abstraction.
 *   - For get-flavors, loadFlavorDescriptions() is mocked so no JSON file is read.
 *   - gameDatabase.localizeObjects is a pass-through (it otherwise throws with no
 *     localization DB).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// get-flavors loads descriptions from a JSON file via the loader; mock that boundary.
vi.mock('../../../src/utils/strategies/loader.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    loadFlavorDescriptions: vi.fn(),
  };
});

import { gameDatabase } from '../../../src/server.js';
import { loadFlavorDescriptions } from '../../../src/utils/strategies/loader.js';
import createGetEconomicStrategyTool from '../../../src/tools/databases/get-economic-strategy.js';
import createGetMilitaryStrategyTool from '../../../src/tools/databases/get-military-strategy.js';
import createGetFlavorsTool from '../../../src/tools/databases/get-flavors.js';

const ECON_ROWS = [
  { Type: 'Expansion', Production: { Expansion: 10 }, Overall: { Growth: 5 }, Description: 'Settle wide' },
  { Type: 'Growth', Production: { Growth: 8 }, Overall: { Growth: 12 }, Description: 'Tall cities' },
  { Type: 'Tradition', Production: { Culture: 4 }, Overall: { Culture: 9 }, Description: 'Cultural focus' },
];

const MIL_ROWS = [
  { Type: 'Conquest', Production: { Offense: 10 }, Overall: { Offense: 8 }, Description: 'Crush enemies' },
  { Type: 'Defense', Production: { Defense: 9 }, Overall: { Defense: 7 }, Description: 'Hold the line' },
];

beforeEach(() => {
  vi.spyOn(gameDatabase, 'localizeObjects').mockImplementation(async (rows: any) => rows);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** Create an economic-strategy tool with fetchSummaries stubbed to canned rows. */
function econTool(rows = ECON_ROWS) {
  const tool = createGetEconomicStrategyTool();
  vi.spyOn(tool as any, 'fetchSummaries').mockResolvedValue(rows);
  return tool;
}

function milTool(rows = MIL_ROWS) {
  const tool = createGetMilitaryStrategyTool();
  vi.spyOn(tool as any, 'fetchSummaries').mockResolvedValue(rows);
  return tool;
}

describe('get-economic-strategies', () => {
  it('lists all strategies (no search) with Production/Overall/Description preserved', async () => {
    const tool = econTool();
    const result = await tool.execute({ MaxResults: 20 } as any);

    expect(result.Count).toBe(3);
    expect(result.Items.map((i: any) => i.Type).sort()).toEqual([
      'Expansion',
      'Growth',
      'Tradition',
    ]);
    const growth = result.Items.find((i: any) => i.Type === 'Growth');
    expect(growth.Production).toEqual({ Growth: 8 });
    expect(growth.Overall).toEqual({ Growth: 12 });
    expect(growth.Description).toBe('Tall cities');
  });

  it('fuzzy-searches by Type and collapses a unique exact match to one item', async () => {
    const tool = econTool();
    const result = await tool.execute({ Search: 'Expansion', MaxResults: 20 } as any);

    expect(result.Count).toBe(1);
    expect(result.Items[0].Type).toBe('Expansion');
    expect(result.Items[0].Description).toBe('Settle wide');
  });

  it('caps the result count with MaxResults', async () => {
    const tool = econTool();
    const result = await tool.execute({ MaxResults: 2 } as any);
    expect(result.Count).toBe(2);
  });
});

describe('get-military-strategies', () => {
  it('lists military strategies with flavor weights preserved', async () => {
    const tool = milTool();
    const result = await tool.execute({ MaxResults: 20 } as any);

    expect(result.Count).toBe(2);
    const conquest = result.Items.find((i: any) => i.Type === 'Conquest');
    expect(conquest.Production).toEqual({ Offense: 10 });
    expect(conquest.Overall).toEqual({ Offense: 8 });
  });

  it('fuzzy-searches by Type', async () => {
    const tool = milTool();
    const result = await tool.execute({ Search: 'Defense', MaxResults: 20 } as any);
    expect(result.Count).toBe(1);
    expect(result.Items[0].Type).toBe('Defense');
  });

  it('surfaces an Error result when the DB read fails', async () => {
    const tool = createGetMilitaryStrategyTool();
    vi.spyOn(tool as any, 'fetchSummaries').mockRejectedValue(new Error('db offline'));
    const result = await tool.execute({ MaxResults: 20 } as any);

    expect(result.Count).toBe(0);
    expect(result.Items).toEqual([]);
    expect(result.Error).toBe('db offline');
  });
});

describe('get-flavors', () => {
  beforeEach(() => {
    (loadFlavorDescriptions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      Offense: 'Tendency toward aggressive military action',
      Defense: 'Tendency to fortify and protect',
      Gold: 'Tendency to prioritize economy',
    });
  });

  it('maps the flavor description map into Name/Description rows', async () => {
    const tool = createGetFlavorsTool();
    const result = await tool.execute({ MaxResults: 20 } as any);

    expect(result.Count).toBe(3);
    const names = result.Items.map((i: any) => i.Name).sort();
    expect(names).toEqual(['Defense', 'Gold', 'Offense']);
    const offense = result.Items.find((i: any) => i.Name === 'Offense');
    expect(offense.Description).toBe('Tendency toward aggressive military action');
  });

  it('fuzzy-searches flavors by Name (identifier field is Name, not Type)', async () => {
    const tool = createGetFlavorsTool();
    const result = await tool.execute({ Search: 'Offense', MaxResults: 20 } as any);

    expect(result.Count).toBe(1);
    expect(result.Items[0].Name).toBe('Offense');
    expect(result.Items[0].Description).toBe('Tendency toward aggressive military action');
  });

  it('caps flavor results with MaxResults', async () => {
    const tool = createGetFlavorsTool();
    const result = await tool.execute({ MaxResults: 1 } as any);
    expect(result.Count).toBe(1);
  });

  it('returns an empty list when no flavor descriptions exist', async () => {
    (loadFlavorDescriptions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const tool = createGetFlavorsTool();
    const result = await tool.execute({ MaxResults: 20 } as any);

    expect(result.Count).toBe(0);
    expect(result.Items).toEqual([]);
  });
});
