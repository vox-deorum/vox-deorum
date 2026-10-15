/**
 * Mock-tier tests for the strategy/flavor DB-lookup tools:
 *   - get-economic-strategies / get-military-strategies (AiStrategyTool)
 *   - get-flavors (DatabaseQueryTool over the flavors JSON)
 *
 * The mock tier has no game DB, so controlled SQLite tables supply strategy rows
 * while calls still pass through the registered tools and their public outputs.
 *   - For get-flavors, loadFlavorDescriptions() is mocked so no JSON file is read.
 *   - gameDatabase.localizeObjects is a pass-through (it otherwise throws with no
 *     localization DB).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DB } from '../../../src/database/database.js';

vi.mock('../../../src/utils/file-utils.js', async (importOriginal) => ({
  ...(await importOriginal() as any),
  writeJsonIfChanged: vi.fn(async () => undefined),
}));

// The strategy tools load descriptions from the JSON files; supply controlled fixture data there.
vi.mock('../../../src/utils/strategies/loader.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    loadFlavorDescriptions: vi.fn(),
    loadEconomicStrategies: vi.fn(),
    loadMilitaryStrategies: vi.fn(),
  };
});

import { gameDatabase } from '../../../src/server.js';
import {
  loadFlavorDescriptions,
  loadEconomicStrategies,
  loadMilitaryStrategies,
} from '../../../src/utils/strategies/loader.js';
import createGetEconomicStrategyTool from '../../../src/tools/databases/get-economic-strategy.js';
import createGetMilitaryStrategyTool from '../../../src/tools/databases/get-military-strategy.js';
import createGetFlavorsTool from '../../../src/tools/databases/get-flavors.js';
import { callToolOnce } from '../tool-client.js';

const ECON_DESCRIPTIONS = [
  { Type: 'Expansion', Description: 'Settle wide' },
  { Type: 'Growth', Description: 'Tall cities' },
  { Type: 'Tradition', Description: 'Cultural focus' },
];
const MIL_DESCRIPTIONS = [
  { Type: 'Conquest', Description: 'Crush enemies' },
  { Type: 'Defense', Description: 'Hold the line' },
];

let db: Kysely<DB>;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE AIEconomicStrategies (Type TEXT);
    CREATE TABLE AIEconomicStrategy_City_Flavors (AIEconomicStrategyType TEXT, FlavorType TEXT, Flavor INTEGER);
    CREATE TABLE AIEconomicStrategy_Player_Flavors (AIEconomicStrategyType TEXT, FlavorType TEXT, Flavor INTEGER);
    CREATE TABLE AIMilitaryStrategies (Type TEXT);
    CREATE TABLE AIMilitaryStrategy_City_Flavors (AIMilitaryStrategyType TEXT, FlavorType TEXT, Flavor INTEGER);
    CREATE TABLE AIMilitaryStrategy_Player_Flavors (AIMilitaryStrategyType TEXT, FlavorType TEXT, Flavor INTEGER);
    INSERT INTO AIEconomicStrategies VALUES ('ECONOMICAISTRATEGY_EXPANSION'), ('ECONOMICAISTRATEGY_GROWTH'), ('ECONOMICAISTRATEGY_TRADITION');
    INSERT INTO AIEconomicStrategy_City_Flavors VALUES ('ECONOMICAISTRATEGY_EXPANSION', 'FLAVOR_EXPANSION', 10), ('ECONOMICAISTRATEGY_GROWTH', 'FLAVOR_GROWTH', 8), ('ECONOMICAISTRATEGY_TRADITION', 'FLAVOR_CULTURE', 4);
    INSERT INTO AIEconomicStrategy_Player_Flavors VALUES ('ECONOMICAISTRATEGY_EXPANSION', 'FLAVOR_GROWTH', 5), ('ECONOMICAISTRATEGY_GROWTH', 'FLAVOR_GROWTH', 12), ('ECONOMICAISTRATEGY_TRADITION', 'FLAVOR_CULTURE', 9);
    INSERT INTO AIMilitaryStrategies VALUES ('MILITARYAISTRATEGY_CONQUEST'), ('MILITARYAISTRATEGY_DEFENSE');
    INSERT INTO AIMilitaryStrategy_City_Flavors VALUES ('MILITARYAISTRATEGY_CONQUEST', 'FLAVOR_OFFENSE', 10), ('MILITARYAISTRATEGY_DEFENSE', 'FLAVOR_DEFENSE', 9);
    INSERT INTO AIMilitaryStrategy_Player_Flavors VALUES ('MILITARYAISTRATEGY_CONQUEST', 'FLAVOR_OFFENSE', 8), ('MILITARYAISTRATEGY_DEFENSE', 'FLAVOR_DEFENSE', 7);
  `);
  db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
  vi.spyOn(gameDatabase, 'getDatabase').mockReturnValue(db);
  vi.spyOn(gameDatabase, 'localizeObjects').mockImplementation(async (rows: any) => rows);
  vi.mocked(loadEconomicStrategies).mockResolvedValue(ECON_DESCRIPTIONS as any);
  vi.mocked(loadMilitaryStrategies).mockResolvedValue(MIL_DESCRIPTIONS as any);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await db.destroy();
});

/** Create an economic strategy tool backed by the controlled database fixture. */
function econTool() {
  return createGetEconomicStrategyTool();
}

/** Construct the military strategy lookup tool. */
function milTool() {
  return createGetMilitaryStrategyTool();
}

// The listing path is shared base behavior over each tool's own canned rows, so one table
// covers both strategy tools and pins their distinct output shapes.
describe('get-economic-strategies / get-military-strategies', () => {
  it.each([
    {
      tool: 'get-economic-strategies',
      makeTool: econTool,
      count: 3,
      types: ['Expansion', 'Growth', 'Tradition'],
      sample: { Type: 'Growth', Production: { Growth: 8 }, Overall: { Growth: 12 }, Description: 'Tall cities' },
    },
    {
      tool: 'get-military-strategies',
      makeTool: milTool,
      count: 2,
      types: ['Conquest', 'Defense'],
      sample: { Type: 'Conquest', Production: { Offense: 10 }, Overall: { Offense: 8 }, Description: 'Crush enemies' },
    },
  ])('$tool lists all strategies (no search) with Production/Overall/Description preserved', async ({ makeTool, count, types, sample }) => {
    const result = await callToolOnce(makeTool(), { MaxResults: 20 });

    expect(result.Count).toBe(count);
    expect(result.Items.map((i: any) => i.Type).sort()).toEqual(types);
    const found = result.Items.find((i: any) => i.Type === sample.Type);
    expect(found.Production).toEqual(sample.Production);
    expect(found.Overall).toEqual(sample.Overall);
    expect(found.Description).toBe(sample.Description);
  });

  it('fuzzy-searches by Type and collapses a unique exact match to one item', async () => {
    const result = await callToolOnce(econTool(), { Search: 'Expansion', MaxResults: 20 });

    expect(result.Count).toBe(1);
    expect(result.Items[0].Type).toBe('Expansion');
    expect(result.Items[0].Description).toBe('Settle wide');
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
    const result = await callToolOnce(createGetFlavorsTool(), { MaxResults: 20 });

    expect(result.Count).toBe(3);
    const names = result.Items.map((i: any) => i.Name).sort();
    expect(names).toEqual(['Defense', 'Gold', 'Offense']);
    const offense = result.Items.find((i: any) => i.Name === 'Offense');
    expect(offense.Description).toBe('Tendency toward aggressive military action');
  });

  it('fuzzy-searches flavors by Name (identifier field is Name, not Type)', async () => {
    const result = await callToolOnce(createGetFlavorsTool(), { Search: 'Offense', MaxResults: 20 });

    expect(result.Count).toBe(1);
    expect(result.Items[0].Name).toBe('Offense');
    expect(result.Items[0].Description).toBe('Tendency toward aggressive military action');
  });

  it('returns an empty list when no flavor descriptions exist', async () => {
    (loadFlavorDescriptions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const result = await callToolOnce(createGetFlavorsTool(), { MaxResults: 20 });

    expect(result.Count).toBe(0);
    expect(result.Items).toEqual([]);
  });
});
