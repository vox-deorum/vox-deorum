/** Localization output backed by controlled real SQLite databases. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseManager } from '../../../src/database/manager.js';
import { configureGameDatabase } from '../../fixtures/game-database.js';

describe('DatabaseManager localization', () => {
  const manager = new DatabaseManager();
  let close: () => Promise<void>;

  beforeAll(async () => { close = await configureGameDatabase(manager); });
  afterAll(async () => { await close?.(); });

  it('resolves a known translation', async () => {
    expect(await manager.localize('TXT_KEY_TECH_AGRICULTURE_TITLE')).toBe('Agriculture');
  });

  it('preserves a missing translation key', async () => {
    expect(await manager.localize('TXT_KEY_THIS_DOES_NOT_EXIST_12345')).toBe('TXT_KEY_THIS_DOES_NOT_EXIST_12345');
  });

  it('translates nested values while retaining empty and missing translations', async () => {
    expect(await manager.localizeObject({
      Name: 'TXT_KEY_TECH_AGRICULTURE_TITLE',
      Details: [{ Help: 'TXT_KEY_FIXTURE_RESEARCH', Empty: 'TXT_KEY_FIXTURE_EMPTY', Missing: 'TXT_KEY_MISSING' }]
    })).toEqual({
      Name: 'Agriculture', Details: [{ Help: 'Research support', Empty: '', Missing: 'TXT_KEY_MISSING' }]
    });
  });
});
