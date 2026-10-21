/** Enum mappings are built only from a game database that matches the live game, and feed readable event output. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { enumMappings } from '../../../src/utils/knowledge/enum.js';
import createGetEventsTool from '../../../src/tools/knowledge/get-events.js';
import { connectToolClient } from '../tool-client.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { gameDatabase } from '../../../src/server.js';
import { enumMappingTables, MappingMismatchError, tableChecksum, type TableChecksum } from '../../../src/database/manager.js';

describe('tableChecksum', () => {
  it('matches the arithmetic of lua/get-table-checksums.lua', () => {
    // "5:A;" folds as (((53 * 31 + 58) * 31 + 65) * 31 + 59) = 1636735
    expect(tableChecksum([{ ID: 5, Type: 'A' }])).toEqual({ Count: 1, Checksum: 1636735 });
  });

  it('ignores the order rows are read in', () => {
    const rows = [{ ID: 0, Type: 'BUILDING_SHRINE' }, { ID: 1, Type: 'BUILDING_MONUMENT' }];
    expect(tableChecksum([...rows].reverse())).toEqual(tableChecksum(rows));
  });

  it('notices swapped IDs, even between equally long types', () => {
    const rows = [{ ID: 0, Type: 'UNIT_WARRIOR' }, { ID: 1, Type: 'UNIT_SETTLER' }];
    const swapped = [{ ID: 1, Type: 'UNIT_WARRIOR' }, { ID: 0, Type: 'UNIT_SETTLER' }];
    expect(tableChecksum(swapped)).not.toEqual(tableChecksum(rows));
  });
});

describe('enum mappings checked against the live game', () => {
  let store: KnowledgeStore;
  let client: Awaited<ReturnType<typeof connectToolClient>> | undefined;
  let sqlite: Database.Database;
  let enumDatabase: Kysely<any>;
  let textDatabase: Kysely<any>;
  let previous: { mainDb: unknown; localizationDb: unknown };
  let previousMappings: Record<string, Record<number, string>>;
  let gameChecksums: Record<string, TableChecksum>;

  beforeEach(async () => {
    store = await setupStore(10);
    previousMappings = { ...enumMappings };
    sqlite = new Database(':memory:');
    sqlite.exec(enumMappingTables.map(([table]) => `CREATE TABLE ${table} (ID INTEGER, Type TEXT, Description TEXT);`).join('\n'));
    sqlite.exec(`INSERT INTO Units VALUES (5, 'UNIT_GREAT_SCIENTIST', 'Great Scientist');`);
    enumDatabase = new Kysely({ dialect: new SqliteDialect({ database: sqlite }) });

    const text = new Database(':memory:');
    text.exec(`
      CREATE TABLE LocalizedText (Language TEXT, Tag TEXT, Text TEXT);
      INSERT INTO LocalizedText VALUES ('en_US', 'TXT_KEY_POLICY_LEGALISM', 'Ceremony');
    `);
    textDatabase = new Kysely({ dialect: new SqliteDialect({ database: text }) });

    previous = { mainDb: (gameDatabase as any).mainDb, localizationDb: (gameDatabase as any).localizationDb };
    Object.assign(gameDatabase, { mainDb: enumDatabase, localizationDb: textDatabase });
    vi.spyOn(gameDatabase, 'localizeObject').mockImplementation(async value => value);

    // The live game reports the same rows the fixture database holds
    gameChecksums = Object.fromEntries(enumMappingTables.map(([table]) =>
      [table, tableChecksum(sqlite.prepare(`SELECT ID, Type FROM ${table}`).all() as { ID: number; Type: string }[])]));
  });

  afterEach(async () => {
    await client?.close();
    client = undefined;
    vi.restoreAllMocks();
    for (const key of Object.keys(enumMappings)) delete enumMappings[key];
    Object.assign(enumMappings, previousMappings);
    Object.assign(gameDatabase, previous);
    await enumDatabase.destroy();
    await textDatabase.destroy();
    await store.close();
  });

  it('returns the mapped GreatPersonType alongside the original event data', async () => {
    await gameDatabase.initializeMappings(gameChecksums);
    await store.storeGameEvent(1, 'GreatPersonExpended', { PlayerID: 1, UnitID: 8, GreatPersonType: 5 });
    client = await connectToolClient(createGetEventsTool());

    const report = await client.call({ Type: 'GreatPersonExpended', Original: true });
    expect(report.events).toEqual([
      expect.objectContaining({ ID: 1, Type: 'GreatPersonExpended', GreatPersonType: 'Great Scientist', UnitID: 8 }),
    ]);
  });

  it('keeps the previous mappings when a table differs from the live game', async () => {
    enumMappings['UnitType'] = { 5: 'Previous' };
    gameChecksums['Units'] = { Count: 1, Checksum: gameChecksums['Units'].Checksum + 1 };

    await expect(gameDatabase.initializeMappings(gameChecksums)).rejects.toBeInstanceOf(MappingMismatchError);
    expect(enumMappings['UnitType']).toEqual({ 5: 'Previous' });
  });

  it('rejects a localization database without Vox Populi text', async () => {
    await textDatabase.updateTable('LocalizedText').set({ Text: 'Legalism' }).execute();
    await expect(gameDatabase.initializeMappings(gameChecksums)).rejects.toBeInstanceOf(MappingMismatchError);
  });
});
