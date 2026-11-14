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
      INSERT INTO LocalizedText (Language, Tag, Text) VALUES ('zh_CN', 'TXT_KEY_NESTED_LABEL', '\u4e2d\u6587\u6807\u7b7e'),
        ('ko_KR', 'TXT_KEY_NESTED_LABEL', '\ud55c\uad6d\uc5b4 \uc774\ub984'), ('zh_CN', 'TXT_KEY_FILLED', NULL),
        ('zh_CN', 'TXT_KEY_EMPTY_HELP', ''), ('en_US', 'TXT_KEY_WRAPPER', 'See {TXT_KEY_NESTED_LABEL}');
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
  it.each(['zh_CN', 'ko_KR'])('falls back through English and preserves empty and nested translations for %s', async language => {
    manager.setLanguage(language);
    expect(await manager.localize('TXT_KEY_FILLED')).toBe('Filled [NEWLINE]text');
    expect(await manager.localize('TXT_KEY_EMPTY_HELP')).toBe('');
    expect(await manager.localize('TXT_KEY_MISSING')).toBe('TXT_KEY_MISSING');
    const [item] = await manager.localizeObjects([{ Label: 'TXT_KEY_WRAPPER', Nested: { Value: 'TXT_KEY_FILLED' }, Empty: 'TXT_KEY_EMPTY_HELP' }]);
    expect(item).toEqual({ Label: language === 'zh_CN' ? 'See \u4e2d\u6587\u6807\u7b7e' : 'See \ud55c\uad6d\uc5b4 \uc774\ub984', Nested: { Value: 'Filled \ntext' }, Empty: '' });
  });

  it('uses English until an automatic language has been verified', () => {
    manager.setLanguage('ko_KR');
    manager.setLanguage('auto');
    expect(manager.getLanguage()).toBe('en_US');
  });

  it('keeps the captured language through asynchronous fallback and recursive substitutions', async () => {
    manager.setLanguage('zh_CN');
    const pending = manager.localizeObjects([{ Label: 'TXT_KEY_WRAPPER' }]);
    manager.setLanguage('ko_KR');
    expect(await pending).toEqual([{ Label: 'See \u4e2d\u6587\u6807\u7b7e' }]);
  });

});
