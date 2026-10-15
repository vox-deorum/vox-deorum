/** A numeric game enum is returned as its readable value by the public events tool. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { enumMappings } from '../../../src/utils/knowledge/enum.js';
import createGetEventsTool from '../../../src/tools/knowledge/get-events.js';
import { connectToolClient } from '../tool-client.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { gameDatabase } from '../../../src/server.js';
import { enumMappingTables } from '../../../src/database/manager.js';

describe('event enum output through MCP', () => {
  let store: KnowledgeStore;
  let client: Awaited<ReturnType<typeof connectToolClient>>;
  let enumDatabase: Kysely<any>;
  let previousMainDatabase: unknown;
  let previousMappings: Record<string, Record<number, string>>;

  beforeEach(async () => {
    store = await setupStore(10);
    previousMappings = { ...enumMappings };
    const sqlite = new Database(':memory:');
    sqlite.exec(enumMappingTables.map(([table]) => table).map(table => `CREATE TABLE ${table} (ID INTEGER, Type TEXT, Description TEXT);`).join('\n'));
    sqlite.exec(`
      INSERT INTO Units VALUES (5, 'UNIT_GREAT_SCIENTIST', 'Great Scientist');
      CREATE TABLE GreatPersons (ID INTEGER, Type TEXT, Description TEXT);
      INSERT INTO GreatPersons VALUES (5, 'GREATPERSON_OTHER', 'Great Merchant');
    `);
    enumDatabase = new Kysely({ dialect: new SqliteDialect({ database: sqlite }) });
    previousMainDatabase = (gameDatabase as any).mainDb;
    Object.assign(gameDatabase, { mainDb: enumDatabase });
    vi.spyOn(gameDatabase, 'localizeObject').mockImplementation(async value => value);
    await gameDatabase.initializeMappings();
    await store.storeGameEvent(1, 'GreatPersonExpended', {
      PlayerID: 1,
      UnitID: 8,
      GreatPersonType: 5,
    });
    client = await connectToolClient(createGetEventsTool());
  });

  afterEach(async () => {
    await client.close();
    vi.restoreAllMocks();
    for (const key of Object.keys(enumMappings)) delete enumMappings[key];
    Object.assign(enumMappings, previousMappings);
    Object.assign(gameDatabase, { mainDb: previousMainDatabase });
    await enumDatabase.destroy();
    await store.close();
  });

  it('returns the mapped GreatPersonType alongside the original event data', async () => {
    const report = await client.call({ Type: 'GreatPersonExpended', Original: true });
    expect(report.events).toEqual([
      expect.objectContaining({
        ID: 1,
        Type: 'GreatPersonExpended',
        GreatPersonType: 'Great Scientist',
        UnitID: 8,
      }),
    ]);
  });
});
