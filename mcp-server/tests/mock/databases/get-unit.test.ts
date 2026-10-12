/** Unit listings leave out barbarian-only units by their civilization type, whatever the localized names say. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DB } from '../../../src/database/database.js';
import { gameDatabase } from '../../../src/server.js';
import createGetUnitTool from '../../../src/tools/databases/get-unit.js';

vi.mock('../../../src/server.js', () => ({
  gameDatabase: { getDatabase: vi.fn(), localizeObjects: vi.fn() },
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
    const result = await createGetUnitTool().execute({ MaxResults: 5000 } as any);

    expect(result.Items.map((item: any) => item.Type).sort()).toEqual(['UNIT_LEGION', 'UNIT_WARRIOR']);
  });
});
