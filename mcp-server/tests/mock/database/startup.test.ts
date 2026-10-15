/** Exercise database startup retry against files that appear after initialization begins. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const documents = vi.hoisted(() => ({ path: '' }));
const retryGate = vi.hoisted(() => {
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  return {
    setTimeout: vi.fn(() => {
      entered();
      return gate;
    }),
    waiting: () => waiting,
    release: () => release(),
  };
});

vi.mock('node:timers/promises', () => ({ setTimeout: retryGate.setTimeout }));
vi.mock('../../../src/utils/config.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/utils/config.js')>();
  return { ...actual, getDocumentsPath: vi.fn(async () => documents.path) };
});

import { DatabaseManager, enumMappingTables } from '../../../src/database/manager.js';
import { enumMappings } from '../../../src/utils/knowledge/enum.js';

const enumTables = enumMappingTables.map(([tableName]) => tableName);

describe('DatabaseManager startup availability', () => {
  let manager: DatabaseManager | undefined;
  let tempDirectory: string | undefined;
  let previousMappings: Record<string, Record<number, string>> | undefined;

  afterEach(async () => {
    await manager?.close();
    if (previousMappings) {
      for (const key of Object.keys(enumMappings)) delete enumMappings[key];
      Object.assign(enumMappings, previousMappings);
    }
    manager = undefined;
    if (tempDirectory) await removeTemporaryDatabase(tempDirectory);
    tempDirectory = undefined;
    retryGate.setTimeout.mockClear();
    vi.restoreAllMocks();
  });

  it('continues initialization when the game database files become available', async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-db-startup-'));
    documents.path = tempDirectory;
    manager = new DatabaseManager();
    previousMappings = { ...enumMappings };
    let initializationSettled = false;
    const initialization = manager.initialize().finally(() => { initializationSettled = true; });
    await retryGate.waiting();

    expect(manager.isInitialized()).toBe(false);
    expect(initializationSettled).toBe(false);

    const cacheDirectory = path.join(tempDirectory, 'My Games', "Sid Meier's Civilization 5", 'cache');
    await fs.mkdir(cacheDirectory, { recursive: true });
    const main = new Database(path.join(cacheDirectory, 'Civ5DebugDatabase.db'));
    for (const table of enumTables) {
      main.exec(`CREATE TABLE ${table} (ID INTEGER, Type TEXT, Description TEXT, Help TEXT)`);
    }
    main.exec(`
      CREATE TABLE TriggerAnchor (ID INTEGER);
      CREATE TRIGGER Unit_BuildingClassPurchaseRequireds AFTER INSERT ON TriggerAnchor BEGIN SELECT 1; END;
      INSERT INTO Units (ID, Type, Description) VALUES (9, 'UNIT_FIXTURE', 'TXT_KEY_FIXTURE_UNIT');
    `);
    main.close();

    const localization = new Database(path.join(cacheDirectory, 'Localization-Merged.db'));
    localization.exec(`
      CREATE TABLE LocalizedText (Language TEXT, Tag TEXT, Text TEXT, Gender TEXT, Plurality TEXT);
      INSERT INTO LocalizedText (Language, Tag, Text) VALUES ('en_US', 'TXT_KEY_FIXTURE_UNIT', 'Fixture unit');
    `);
    localization.close();
    retryGate.release();
    await initialization;

    expect(manager.isInitialized()).toBe(true);
    const units = await manager.getDatabase().selectFrom('Units').select(['ID', 'Type']).execute();
    expect(units).toEqual([{ ID: 9, Type: 'UNIT_FIXTURE' }]);
  }, 15000);
});

/** Retry Windows SQLite cleanup briefly after all public manager handles close. */
async function removeTemporaryDatabase(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 19) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}
