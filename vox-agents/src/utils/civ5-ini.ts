import iniApi, { type Ini as IniDocument, type IniLine, type IniSection } from 'ini-api/index.js';

const { Ini } = iniApi;

const CONFIG_SECTION = 'CONFIG';
const GAME_SETTINGS_SECTION = 'GameSettings';
const SYNC_SEED_KEY = 'SyncRandSeed';
const MAP_SEED_KEY = 'MapRandSeed';
const QUICK_COMBAT_KEY = 'SinglePlayerQuickCombatEnabled';
const QUICK_MOVEMENT_KEY = 'SinglePlayerQuickMovementEnabled';

/**
 * Concrete values to write into Civ's config.ini.
 *
 * Restoration passes strings so we keep the previous textual seed values when
 * possible; launch-time writes pass numbers.
 */
export interface CivConfigSeeds {
  sync: number | string;
  map: number | string;
}

/** Read Civ's pregame seed settings from raw config.ini content. */
export function readCivConfigSeedsContent(content: string): { sync?: string; map?: string } {
  const ini = new Ini(content);
  const config = getSectionIgnoreCase(ini, CONFIG_SECTION);
  return {
    sync: getValueIgnoreCase(config, SYNC_SEED_KEY),
    map: getValueIgnoreCase(config, MAP_SEED_KEY)
  };
}

/** Update Civ's pregame seed settings while preserving comments and nearby lines. */
export function updateCivConfigSeedsContent(content: string, seeds: CivConfigSeeds): string {
  const ini = new Ini(content);
  const config = getOrAddSection(ini, CONFIG_SECTION);

  setValueIgnoreCase(config, SYNC_SEED_KEY, seeds.sync);
  setValueIgnoreCase(config, MAP_SEED_KEY, seeds.map);

  return ini.stringify();
}

/** Update single-player quick combat and movement settings in UserSettings.ini. */
export function updateCivUserSettingsSkipAnimationsContent(content: string, enabled: boolean): string {
  const ini = new Ini(content);
  const gameSettings = getOrAddSection(ini, GAME_SETTINGS_SECTION);
  const value = enabled ? '1' : '0';

  setValueIgnoreCase(gameSettings, QUICK_COMBAT_KEY, value);
  setValueIgnoreCase(gameSettings, QUICK_MOVEMENT_KEY, value);

  return ini.stringify();
}

function getOrAddSection(ini: IniDocument, sectionName: string): IniSection {
  return getSectionIgnoreCase(ini, sectionName) ?? ini.addSection(sectionName);
}

function getSectionIgnoreCase(ini: IniDocument, sectionName: string): IniSection | undefined {
  const target = sectionName.toLowerCase();
  return ini.sections.find(section => section.name?.toLowerCase() === target);
}

function getValueIgnoreCase(section: IniSection | undefined, key: string): string | undefined {
  const line = getLineIgnoreCase(section, key);
  if (!line || line.value === undefined) return undefined;
  return String(line.value);
}

function setValueIgnoreCase(section: IniSection, key: string, value: number | string): void {
  const line = getLineIgnoreCase(section, key);
  if (line) {
    // ini-api preserves comments but rebuilds edited pair lines as key=value.
    line.value = String(value);
    return;
  }

  section.setValue(key, String(value));
}

function getLineIgnoreCase(section: IniSection | undefined, key: string): IniLine | undefined {
  if (!section) return undefined;
  const target = key.toLowerCase();
  return section.lines.find(line => line.key?.toLowerCase() === target);
}
