import { describe, expect, it } from 'vitest';
import {
  readCivConfigSeedsContent,
  updateCivConfigSeedsContent,
  updateCivUserSettingsSkipAnimationsContent
} from '../../../src/utils/game/civ5-ini.js';

describe('Civ config.ini seed updates', () => {
  it('reads existing CONFIG seed values', () => {
    const content = [
      '[CONFIG]',
      'SyncRandSeed = 123',
      'MapRandSeed = 456'
    ].join('\n');

    expect(readCivConfigSeedsContent(content)).toEqual({ sync: '123', map: '456' });
  });

  it('updates seed values while preserving comments and unrelated settings', () => {
    const content = [
      '[Debugging]',
      'EnableTuner = 0',
      '',
      '[CONFIG]',
      '; Random seed for game sync',
      'SyncRandSeed = 0 ; keep this comment',
      'MapRandSeed = 0',
      'QuickStart = 0',
      '',
      '[GAME]',
      'WorldSize = WORLDSIZE_TINY'
    ].join('\r\n');

    const updated = updateCivConfigSeedsContent(content, { sync: 123, map: 456 });

    expect(readCivConfigSeedsContent(updated)).toEqual({ sync: '123', map: '456' });
    expect(updated).toContain('; Random seed for game sync');
    expect(updated).toContain('SyncRandSeed=123 ; keep this comment');
    expect(updated).toContain('EnableTuner = 0');
    expect(updated).toContain('QuickStart = 0');
    expect(updated).toContain('WorldSize = WORLDSIZE_TINY');
  });

  it('adds missing seed keys with canonical Civ names', () => {
    const updated = updateCivConfigSeedsContent('[CONFIG]\nQuickStart = 0\n[GAME]\nGameName = Test', {
      sync: 123,
      map: 456
    });

    expect(readCivConfigSeedsContent(updated)).toEqual({ sync: '123', map: '456' });
    expect(updated).toContain('SyncRandSeed=123');
    expect(updated).toContain('MapRandSeed=456');
    expect(updated).toContain('[GAME]');
  });

  it('adds the CONFIG section when it is missing', () => {
    const updated = updateCivConfigSeedsContent('[GAME]\nGameName = Test', {
      sync: '11',
      map: '22'
    });

    expect(updated).toContain('[CONFIG]');
    expect(readCivConfigSeedsContent(updated)).toEqual({ sync: '11', map: '22' });
  });

  it('matches existing section and key names case-insensitively', () => {
    const updated = updateCivConfigSeedsContent('[config]\nsyncrandseed = 9\nmaprandseed = 10', {
      sync: 1,
      map: 2
    });

    expect(readCivConfigSeedsContent(updated)).toEqual({ sync: '1', map: '2' });
    expect(updated).toContain('[config]');
    expect(updated).toContain('syncrandseed=1');
  });
});

describe('Civ UserSettings.ini animation updates', () => {
  it('updates quick combat and movement values under GameSettings', () => {
    const content = [
      '[GameSettings]',
      '; animation controls',
      'SinglePlayerQuickCombatEnabled = 0',
      'SinglePlayerQuickMovementEnabled = 0',
      'PolicyInfo = 1'
    ].join('\n');

    const updated = updateCivUserSettingsSkipAnimationsContent(content, true);

    expect(updated).toContain('; animation controls');
    expect(updated).toContain('SinglePlayerQuickCombatEnabled=1');
    expect(updated).toContain('SinglePlayerQuickMovementEnabled=1');
    expect(updated).toContain('PolicyInfo = 1');
  });

  it('writes zero when animation skipping is disabled', () => {
    const content = [
      '[GameSettings]',
      'SinglePlayerQuickCombatEnabled = 1',
      'SinglePlayerQuickMovementEnabled = 1'
    ].join('\n');

    const updated = updateCivUserSettingsSkipAnimationsContent(content, false);

    expect(updated).toContain('SinglePlayerQuickCombatEnabled=0');
    expect(updated).toContain('SinglePlayerQuickMovementEnabled=0');
  });

  it('adds missing GameSettings keys with canonical Civ names', () => {
    const updated = updateCivUserSettingsSkipAnimationsContent('[Audio]\nMasterVolume = 1', true);

    expect(updated).toContain('[GameSettings]');
    expect(updated).toContain('SinglePlayerQuickCombatEnabled=1');
    expect(updated).toContain('SinglePlayerQuickMovementEnabled=1');
    expect(updated).toContain('MasterVolume = 1');
  });
});
