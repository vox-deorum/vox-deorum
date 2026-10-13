/**
 * Tests for the enum mappings set up by DatabaseManager.initializeMappings (src/database/manager.ts):
 * the GreatPersonExpended event's GreatPersonType carries a unit type, so it decodes to the unit's
 * name rather than to the GreatPersons row with the same ID.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseManager } from '../../../src/database/manager.js';
import { enumMappings, explainEnums } from '../../../src/utils/knowledge/enum.js';

describe('DatabaseManager enum mappings', () => {
  let original: typeof enumMappings;

  beforeEach(() => {
    // Snapshot existing mappings so overwritten values can be restored after each test.
    original = { ...enumMappings };
  });

  afterEach(() => {
    for (const name of Object.keys(enumMappings)) {
      if (!(name in original)) delete enumMappings[name];
    }
    Object.assign(enumMappings, original);
    vi.restoreAllMocks();
  });

  it('should decode a GreatPersonExpended GreatPersonType as a unit', async () => {
    const manager = new DatabaseManager();
    // Each table maps ID 5 to a different name, so the decoded value shows which table was used
    vi.spyOn(manager, 'addEnumMappings').mockImplementation(async (tableName: string, mappedName: string) => {
      enumMappings[mappedName] = { 5: `${tableName} 5` };
    });

    await manager.initializeMappings();

    expect(explainEnums({ PlayerID: 1, UnitID: 9, GreatPersonType: 5 }).GreatPersonType).toBe('Units 5');
  });
});
