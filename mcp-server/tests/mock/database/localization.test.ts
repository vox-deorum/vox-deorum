/** Tests for localizing TXT_KEY references (src/database/manager.ts). */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { DB as LocalizationDB } from '../../../src/database/localization.js';
import { DatabaseManager } from '../../../src/database/manager.js';

describe('DatabaseManager localization', () => {
  let localizationDb: Kysely<LocalizationDB>;
  let manager: DatabaseManager;

  beforeEach(() => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE LocalizedText (Language TEXT, Tag TEXT, Text TEXT, Gender TEXT, Plurality TEXT);
      INSERT INTO LocalizedText (Language, Tag, Text) VALUES ('en_US', 'TXT_KEY_FILLED', 'Filled [NEWLINE]text');
      INSERT INTO LocalizedText (Language, Tag, Text) VALUES ('en_US', 'TXT_KEY_NESTED_LABEL', 'English label');
      INSERT INTO LocalizedText (Language, Tag, Text) VALUES ('de_DE', 'TXT_KEY_NESTED_LABEL', 'Deutsche Bezeichnung');
      INSERT INTO LocalizedText (Language, Tag, Text) VALUES ('en_US', 'TXT_KEY_EMPTY_HELP', '');
      INSERT INTO LocalizedText (Language, Tag, Text) VALUES ('de_DE', 'TXT_KEY_EMPTY_HELP', 'Deutscher Text');
    `);
    localizationDb = new Kysely<LocalizationDB>({ dialect: new SqliteDialect({ database: sqlite }) });
    manager = new DatabaseManager();
    (manager as any).localizationDb = localizationDb;
    (manager as any).language = 'en_US';
  });

  afterEach(async () => {
    await localizationDb.destroy();
  });

  it('should localize empty text to an empty string rather than the key', async () => {
    const [item] = await manager.localizeObjects([{ Help: 'TXT_KEY_EMPTY_HELP', Name: 'TXT_KEY_FILLED', Note: 'See {TXT_KEY_EMPTY_HELP}.' }]);

    expect(item).toEqual({ Help: '', Name: 'Filled \ntext', Note: 'See .' });
  });

  it('should keep a key that has no text at all', async () => {
    const [item] = await manager.localizeObjects([{ Help: 'TXT_KEY_MISSING', Name: 'TXT_KEY_FILLED' }]);

    expect(item.Help).toBe('TXT_KEY_MISSING');
  });

  it('uses the newly selected language for nested values', async () => {
    const input = [{ Panel: { Label: 'TXT_KEY_NESTED_LABEL' }, Rows: [{ Label: 'TXT_KEY_NESTED_LABEL' }] }];

    const [english] = await manager.localizeObjects(input);
    manager.setLanguage('de_DE');
    const [german] = await manager.localizeObjects(input);

    expect(english.Panel.Label).toBe('English label');
    expect(german).toEqual({
      Panel: { Label: 'Deutsche Bezeichnung' },
      Rows: [{ Label: 'Deutsche Bezeichnung' }],
    });
  });
});
