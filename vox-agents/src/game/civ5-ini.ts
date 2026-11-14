import iniApi, { type Ini as IniDocument, type IniLine, type IniSection } from 'ini-api/index.js';

const { Ini } = iniApi;

const CONFIG_SECTION = 'CONFIG';
const GAME_SETTINGS_SECTION = 'GameSettings';
const SYNC_SEED_KEY = 'SyncRandSeed';
const MAP_SEED_KEY = 'MapRandSeed';
const USER_SETTINGS_SECTION = 'UserSettings';
// The human slot's last chosen civilization. -1 means random.
const LAST_CIV_KEY = 'LastCiv';
const LAST_MAP_SCRIPT_KEY = 'LastMapScript';
const LAST_MAP_SCRIPT_RANDOM_KEY = 'LastMapScriptRandom';
const QUICK_COMBAT_KEY = 'SinglePlayerQuickCombatEnabled';
const QUICK_MOVEMENT_KEY = 'SinglePlayerQuickMovementEnabled';
const DEBUG_SECTION = 'DEBUG';
const LOGGING_ENABLED_KEY = 'LoggingEnabled';
// The mod folder was renamed from "(1b) Vox Deorum" to "(5) Vox Deorum".
const legacyMapScriptPattern = /^(\s*LastMapScript\s*=.*?[\\/])\(1b\) Vox Deorum(?=[\\/])/im;

/**
 * Concrete values to write into Civ's config.ini.
 *
 * Restoration passes strings so we keep the previous textual seed values when
 * possible; launch-time writes pass numbers. `lastCiv` is left untouched when
 * omitted.
 */
export interface CivConfigSeeds {
  sync: number | string;
  map: number | string;
  lastCiv?: number | string;
}

/**
 * Civ's saved map script selection in config.ini, as raw text. An undefined
 * field stands for a missing key.
 */
export interface CivConfigMapScript {
  script?: string;
  random?: string;
}

/** Read Civ's saved map script selection from raw config.ini content. */
export function readCivConfigMapScriptContent(content: string): CivConfigMapScript {
  const userSettings = getSectionIgnoreCase(new Ini(content), USER_SETTINGS_SECTION);
  return {
    script: getRawValueIgnoreCase(userSettings, LAST_MAP_SCRIPT_KEY),
    random: getRawValueIgnoreCase(userSettings, LAST_MAP_SCRIPT_RANDOM_KEY)
  };
}

/** Write Civ's saved map script selection; an undefined field removes that key. */
export function updateCivConfigMapScriptContent(content: string, selection: CivConfigMapScript): string {
  const ini = new Ini(content);
  const userSettings = getOrAddSection(ini, USER_SETTINGS_SECTION);
  setRawValueIgnoreCase(userSettings, LAST_MAP_SCRIPT_KEY, selection.script);
  setRawValueIgnoreCase(userSettings, LAST_MAP_SCRIPT_RANDOM_KEY, selection.random);
  return ini.stringify();
}

/** Read Civ's pregame seed settings and the human slot's last civ from raw config.ini content. */
export function readCivConfigSeedsContent(content: string): { sync?: string; map?: string; lastCiv?: string } {
  const ini = new Ini(content);
  const config = getSectionIgnoreCase(ini, CONFIG_SECTION);
  return {
    sync: getValueIgnoreCase(config, SYNC_SEED_KEY),
    map: getValueIgnoreCase(config, MAP_SEED_KEY),
    lastCiv: getValueIgnoreCase(getSectionIgnoreCase(ini, USER_SETTINGS_SECTION), LAST_CIV_KEY)
  };
}

/** Update Civ's pregame seed settings while preserving comments and nearby lines. */
export function updateCivConfigSeedsContent(content: string, seeds: CivConfigSeeds): string {
  const ini = new Ini(content);
  const config = getOrAddSection(ini, CONFIG_SECTION);

  setValueIgnoreCase(config, SYNC_SEED_KEY, seeds.sync);
  setValueIgnoreCase(config, MAP_SEED_KEY, seeds.map);
  if (seeds.lastCiv !== undefined) {
    setValueIgnoreCase(getOrAddSection(ini, USER_SETTINGS_SECTION), LAST_CIV_KEY, seeds.lastCiv);
  }

  return ini.stringify();
}

/**
 * Point LastMapScript at the current Vox Deorum mod folder when it still names
 * the legacy "(1b) Vox Deorum" folder. Automated starts reuse the last map
 * script, and a path to the removed folder launches with no map script at all.
 */
export function updateCivConfigLegacyMapScriptContent(content: string): string {
  // Edit the raw line: ini-api treats backslashes as escapes and would strip
  // the Windows path separators this match depends on.
  return content.replace(legacyMapScriptPattern, '$1(5) Vox Deorum');
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

/** Read whether Civ's own logging (Lua.log and friends) is enabled in config.ini. */
export function readCivLoggingEnabledContent(content: string): boolean {
  const ini = new Ini(content);
  const value = getValueIgnoreCase(getSectionIgnoreCase(ini, DEBUG_SECTION), LOGGING_ENABLED_KEY);
  return value?.trim() === '1';
}

/** Turn Civ's own logging on or off in config.ini while preserving other settings. */
export function updateCivLoggingEnabledContent(content: string, enabled: boolean): string {
  const ini = new Ini(content);
  setValueIgnoreCase(getOrAddSection(ini, DEBUG_SECTION), LOGGING_ENABLED_KEY, enabled ? '1' : '0');
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

// ini-api treats backslashes in values as escapes, so Windows paths are read
// and written as raw line text instead of through its value accessors.

/** Read the raw text after `=` on a key's line. */
function getRawValueIgnoreCase(section: IniSection | undefined, key: string): string | undefined {
  const text = getLineIgnoreCase(section, key)?.text;
  if (text === undefined) return undefined;
  const separator = text.indexOf('=');
  return separator === -1 ? '' : text.slice(separator + 1).trim();
}

/** Write a key's line with a raw value, or remove the line when the value is undefined. */
function setRawValueIgnoreCase(section: IniSection, key: string, value: string | undefined): void {
  const line = getLineIgnoreCase(section, key);
  if (value === undefined) {
    if (line) section.lines.splice(section.lines.indexOf(line), 1);
    return;
  }

  const text = `${line?.key ?? key} = ${value}`;
  if (line) {
    line.text = text;
  } else {
    section.addLine(text);
  }
}

/** Find a key's line in a section, ignoring case. */
function getLineIgnoreCase(section: IniSection | undefined, key: string): IniLine | undefined {
  if (!section) return undefined;
  const target = key.toLowerCase();
  return section.lines.find(line => line.key?.toLowerCase() === target);
}
