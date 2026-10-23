import { describe, expect, it } from 'vitest';
import {
  readCivConfigMapScriptContent,
  readCivConfigSeedsContent,
  readCivLoggingEnabledContent,
  updateCivConfigLegacyMapScriptContent,
  updateCivConfigMapScriptContent,
  updateCivConfigSeedsContent,
  updateCivLoggingEnabledContent,
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

  it('reads and updates LastCiv in the UserSettings section', () => {
    const content = [
      '[CONFIG]',
      'SyncRandSeed = 0',
      'MapRandSeed = 0',
      '',
      '[UserSettings]',
      '; Last Civilization Played',
      'LastCiv = 29'
    ].join('\r\n');

    expect(readCivConfigSeedsContent(content).lastCiv).toBe('29');

    const updated = updateCivConfigSeedsContent(content, { sync: 1, map: 1, lastCiv: -1 });

    expect(readCivConfigSeedsContent(updated)).toEqual({ sync: '1', map: '1', lastCiv: '-1' });
    expect(updated).toContain('; Last Civilization Played');
  });

  it('leaves LastCiv untouched when it is omitted', () => {
    const updated = updateCivConfigSeedsContent('[CONFIG]\nSyncRandSeed = 0\n[UserSettings]\nLastCiv = 29', {
      sync: 1,
      map: 1
    });

    expect(readCivConfigSeedsContent(updated).lastCiv).toBe('29');
  });
});

describe('Civ config.ini legacy map script repair', () => {
  const modsDir = String.raw`D:\Documents\My Games\Sid Meier's Civilization 5\MODS`;

  it('moves a Windows LastMapScript path from the legacy mod folder to the current one', () => {
    const content = [
      '[UserSettings]',
      '; Last Map Type Played',
      String.raw`LastMapScript = ${modsDir}\(1b) Vox Deorum\Mapscripts/Vox_Deorum.lua`,
      'LastMapScriptRandom = 0'
    ].join('\r\n');

    const updated = updateCivConfigLegacyMapScriptContent(content);

    expect(updated).toBe(content.replace('(1b) Vox Deorum', '(5) Vox Deorum'));
  });

  it('leaves current and unrelated map scripts alone', () => {
    const current = String.raw`[UserSettings]` + '\n' + String.raw`LastMapScript = ${modsDir}\(5) Vox Deorum\Mapscripts/Vox_Deorum.lua`;
    const builtIn = '[UserSettings]\nLastMapScript = Assets\Maps\Continents.lua';

    expect(updateCivConfigLegacyMapScriptContent(current)).toBe(current);
    expect(updateCivConfigLegacyMapScriptContent(builtIn)).toBe(builtIn);
  });
});

describe('Civ config.ini map script selection', () => {
  const modMap = String.raw`D:\Documents\My Games\Sid Meier's Civilization 5\MODS\(5) Vox Deorum\Mapscripts/Vox_Deorum.lua`;

  it('should read Windows map script paths without losing backslashes', () => {
    const content = `[UserSettings]\r\n; Last Map Type Played\r\nLastMapScript = ${modMap}\r\nLastMapScriptRandom = 1`;

    expect(readCivConfigMapScriptContent(content)).toEqual({ script: modMap, random: '1' });
  });

  it('should replace the selection while keeping Windows paths and other settings', () => {
    const content = `[CONFIG]\r\nSyncRandSeed = 0\r\n[UserSettings]\r\nLastMapScript = ${modMap}\r\nLastMapScriptRandom = 1\r\nLastCiv = 29`;
    const override = String.raw`Assets\Maps\Continents.lua`;

    const updated = updateCivConfigMapScriptContent(content, { script: override, random: '0' });

    expect(readCivConfigMapScriptContent(updated)).toEqual({ script: override, random: '0' });
    expect(readCivConfigSeedsContent(updated)).toEqual({ sync: '0', map: undefined, lastCiv: '29' });
  });

  it('should add missing keys and remove keys set to undefined', () => {
    const added = updateCivConfigMapScriptContent('[CONFIG]\nSyncRandSeed = 0', { script: 'map.lua', random: '0' });
    expect(readCivConfigMapScriptContent(added)).toEqual({ script: 'map.lua', random: '0' });

    const removed = updateCivConfigMapScriptContent(added, {});
    expect(readCivConfigMapScriptContent(removed)).toEqual({});
    expect(readCivConfigSeedsContent(removed).sync).toBe('0');
  });
});

describe('Civ config.ini logging switch', () => {
  it('reads LoggingEnabled as on only when it is 1', () => {
    expect(readCivLoggingEnabledContent('[DEBUG]\nLoggingEnabled = 1')).toBe(true);
    expect(readCivLoggingEnabledContent('[DEBUG]\nLoggingEnabled = 0')).toBe(false);
    expect(readCivLoggingEnabledContent('[CONFIG]\nQuickStart = 0')).toBe(false);
  });

  it('turns logging on and off while preserving comments and unrelated settings', () => {
    const content = [
      '[DEBUG]',
      '; Enable the logging system',
      'LoggingEnabled = 0',
      'MessageLog = 0',
      '',
      '[GAME]',
      'WorldSize = WORLDSIZE_TINY'
    ].join('\r\n');

    const enabled = updateCivLoggingEnabledContent(content, true);
    expect(readCivLoggingEnabledContent(enabled)).toBe(true);
    expect(enabled).toContain('; Enable the logging system');
    expect(enabled).toContain('MessageLog = 0');
    expect(enabled).toContain('WorldSize = WORLDSIZE_TINY');

    expect(readCivLoggingEnabledContent(updateCivLoggingEnabledContent(enabled, false))).toBe(false);
  });

  it('matches the section and key case-insensitively', () => {
    const updated = updateCivLoggingEnabledContent('[debug]\nloggingenabled = 0', true);

    expect(readCivLoggingEnabledContent(updated)).toBe(true);
    expect(updated.match(/\[debug\]/gi)).toHaveLength(1);
  });

  it('adds the DEBUG section to an empty file', () => {
    const updated = updateCivLoggingEnabledContent('', true);

    expect(updated).toContain('[DEBUG]');
    expect(readCivLoggingEnabledContent(updated)).toBe(true);
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
