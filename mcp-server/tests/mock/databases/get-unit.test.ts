/**
 * Unit listings leave out barbarian-only units by their civilization type, whatever the localized
 * names say, and full reports name the standard unit a unique unit replaces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DB } from '../../../src/database/database.js';
import { gameDatabase } from '../../../src/server.js';
import createGetUnitTool from '../../../src/tools/databases/get-unit.js';
import { callToolOnce } from '../tool-client.js';

/** Invoke a get-unit query through an MCP client with the current fixture. */
const callUnit = (args: Record<string, unknown>) => callToolOnce(createGetUnitTool(), args);

vi.mock('../../../src/server.js', () => ({
  gameDatabase: { getDatabase: vi.fn(), getGeneration: vi.fn(() => 0), localizeObjects: vi.fn(), localize: vi.fn() },
}));

describe('get-unit listing', () => {
  let db: Kysely<DB>;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE Units (Type TEXT, Description TEXT, Strategy TEXT, Combat INTEGER, RangedCombat INTEGER, Moves INTEGER, Cost INTEGER, PrereqTech TEXT, ShowInPedia INTEGER);
      CREATE TABLE Technologies (Type TEXT, Description TEXT, Era TEXT);
      CREATE TABLE Civilization_UnitClassOverrides (UnitType TEXT, CivilizationType TEXT);
      CREATE TABLE Civilizations (Type TEXT, ShortDescription TEXT);
      CREATE TABLE Eras (Type TEXT);
      INSERT INTO Civilizations VALUES ('CIVILIZATION_BARBARIAN', 'Barbaren'), ('CIVILIZATION_ROME', 'Rom');
      INSERT INTO Units VALUES ('UNIT_WARRIOR', 'Krieger', NULL, 8, 0, 2, 40, NULL, 1);
      INSERT INTO Units VALUES ('UNIT_LEGION', 'Legion', NULL, 17, 0, 2, 90, NULL, 1);
      INSERT INTO Units VALUES ('UNIT_BARBARIAN_WARRIOR', 'Krieger', NULL, 8, 0, 2, 40, NULL, 1);
      INSERT INTO Civilization_UnitClassOverrides VALUES ('UNIT_LEGION', 'CIVILIZATION_ROME'), ('UNIT_BARBARIAN_WARRIOR', 'CIVILIZATION_BARBARIAN');
    `);
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    vi.spyOn(gameDatabase, 'getDatabase').mockReturnValue(db);
    vi.spyOn(gameDatabase, 'localizeObjects').mockImplementation(async rows => rows);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.destroy();
  });

  it('should list regular and unique units but not barbarian-only ones', async () => {
    const result = await callUnit({ MaxResults: 5000 });

    expect(result.Items.map((item: any) => item.Type).sort()).toEqual(['UNIT_LEGION', 'UNIT_WARRIOR']);
  });
});

describe('get-unit full report', () => {
  let db: Kysely<DB>;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE Units (Type TEXT, Description TEXT, Strategy TEXT, Combat INTEGER, RangedCombat INTEGER, Moves INTEGER, Cost INTEGER, PrereqTech TEXT, ObsoleteTech TEXT, Class TEXT, DefaultUnitAI TEXT, Range INTEGER, ExtraMaintenanceCost INTEGER, ShowInPedia INTEGER);
      CREATE TABLE UnitClasses (Type TEXT, Description TEXT, DefaultUnit TEXT);
      CREATE TABLE Technologies (Type TEXT, Description TEXT, Era TEXT);
      CREATE TABLE Eras (Type TEXT);
      CREATE TABLE Civilization_UnitClassOverrides (UnitType TEXT, CivilizationType TEXT);
      CREATE TABLE Civilizations (Type TEXT, ShortDescription TEXT);
      CREATE TABLE Unit_ClassUpgrades (UnitType TEXT, UnitClassType TEXT);
      CREATE TABLE Unit_ResourceQuantityRequirements (UnitType TEXT, ResourceType TEXT, Cost INTEGER);
      CREATE TABLE Resources (Type TEXT, Description TEXT);
      CREATE TABLE Unit_FreePromotions (UnitType TEXT, PromotionType TEXT);
      CREATE TABLE UnitPromotions (Type TEXT, Description TEXT);
      INSERT INTO Eras VALUES ('ERA_MEDIEVAL');
      INSERT INTO UnitClasses VALUES ('UNITCLASS_WARRIOR', 'Warrior class', 'UNIT_WARRIOR'), ('UNITCLASS_SCOUT', 'Scout class', NULL);
      INSERT INTO Civilizations VALUES ('CIVILIZATION_AZTEC', 'Aztec');
      INSERT INTO Units VALUES ('UNIT_WARRIOR', 'Warrior', NULL, 8, 0, 2, 40, NULL, NULL, 'UNITCLASS_WARRIOR', 'UNITAI_ATTACK', 0, 0, 1);
      INSERT INTO Units VALUES ('UNIT_JAGUAR', 'Jaguar', NULL, 8, 0, 2, 40, NULL, NULL, 'UNITCLASS_WARRIOR', 'UNITAI_ATTACK', 0, 0, 1);
      INSERT INTO Units VALUES ('UNIT_PATHFINDER', 'Pathfinder', NULL, 4, 0, 3, 30, NULL, NULL, 'UNITCLASS_SCOUT', 'UNITAI_EXPLORE', 0, 0, 1);
      INSERT INTO Civilization_UnitClassOverrides VALUES ('UNIT_JAGUAR', 'CIVILIZATION_AZTEC'), ('UNIT_PATHFINDER', 'CIVILIZATION_AZTEC');
      INSERT INTO UnitClasses VALUES ('UNITCLASS_SPEARMAN', 'Spearman class', 'UNIT_SPEARMAN'), ('UNITCLASS_PIKEMAN', 'Pikeman class', 'UNIT_PIKEMAN');
      INSERT INTO Units VALUES ('UNIT_SPEARMAN', 'Spearman', NULL, 11, 0, 2, 56, NULL, NULL, 'UNITCLASS_SPEARMAN', 'UNITAI_DEFENSE', 0, 0, 1);
      INSERT INTO Units VALUES ('UNIT_LANDSKNECHT', 'Landsknecht', NULL, 16, 0, 2, 90, NULL, NULL, 'UNITCLASS_PIKEMAN', 'UNITAI_DEFENSE', 0, 0, 1);
      INSERT INTO Units VALUES ('UNIT_PIKEMAN', 'Pikeman', NULL, 16, 0, 2, 90, NULL, NULL, 'UNITCLASS_PIKEMAN', 'UNITAI_DEFENSE', 0, 0, 1);
      INSERT INTO Unit_ClassUpgrades VALUES ('UNIT_JAGUAR', 'UNITCLASS_SPEARMAN'), ('UNIT_WARRIOR', 'UNITCLASS_SPEARMAN'), ('UNIT_SPEARMAN', 'UNITCLASS_PIKEMAN');
      INSERT INTO Resources VALUES ('RESOURCE_IRON', 'TXT_KEY_RESOURCE_IRON');
      INSERT INTO Unit_ResourceQuantityRequirements VALUES ('UNIT_PIKEMAN', 'RESOURCE_IRON', 1);
    `);
    db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    vi.spyOn(gameDatabase, 'getDatabase').mockReturnValue(db);
    vi.spyOn(gameDatabase, 'localize').mockImplementation(async key => key === 'TXT_KEY_RESOURCE_IRON' ? 'Iron' : key);
    vi.spyOn(gameDatabase, 'localizeObjects').mockImplementation(async rows => rows);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.destroy();
  });

  it('should name the standard unit a unique unit replaces', async () => {
    const result = await callUnit({ Search: 'Jaguar' });
    expect(result.Items).toHaveLength(1);
    expect(result.Items[0]).toMatchObject({ UniqueOf: 'Aztec', Replaces: 'Warrior' });
  });

  it('should leave Replaces empty for standard units and classes without a standard unit', async () => {
    const warrior = await callUnit({ Search: 'Warrior' });
    const pathfinder = await callUnit({ Search: 'Pathfinder' });
    expect(warrior.Items[0].Replaces).toBeNull();
    expect(pathfinder.Items[0].Replaces).toBeNull();
  });

  it('should name the standard unit that upgrades into this one, separately from the upgrade target', async () => {
    // Landsknecht shares the Pikeman class and comes first, but the standard unit is named
    const spearman = await callUnit({ Search: 'Spearman' });
    const pikeman = await callUnit({ Search: 'Pikeman' });
    const warrior = await callUnit({ Search: 'Warrior' });
    expect(spearman.Items[0]).toMatchObject({ UpgradedFrom: 'Warrior', UpgradesTo: 'Pikeman' });
    expect(pikeman.Items[0]).toMatchObject({ UpgradedFrom: 'Spearman', UpgradesTo: null });
    expect(warrior.Items[0].UpgradedFrom).toBeNull();
  });

  it('should key required resources by their localized names', async () => {
    const result = await callUnit({ Search: 'Pikeman' });
    expect(result.Items[0].RequiredResources).toEqual({ Iron: 1 });
  });
});
