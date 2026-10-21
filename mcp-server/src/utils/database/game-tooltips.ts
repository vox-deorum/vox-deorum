/**
 * Fetch the game's own tooltips for database entries through the Vox Deorum mod's
 * `VoxDeorumReferenceTooltips` function (civ5-mod/Lua/VoxDeorumReference.lua), which builds
 * player-agnostic text with the same tooltip code the in-game screens use.
 */

import { bridgeManager, gameDatabase } from '../../server.js';
import { stripTags } from './localized.js';

/** Entry kinds the game function can describe. */
export type TooltipKind = 'unit' | 'building' | 'technology' | 'project';

/** Name of the function the mod registers with the DLL. */
export const gameTooltipFunction = 'VoxDeorumReferenceTooltips';

/** Script that asks the mod to register the function; the mod waits for it because registering at load crashes the game. */
const registerScript = 'LuaEvents.VoxDeorumReferenceRegister()\nreturn true';

/** Types per call, which keeps each response well under the DLL's 512 KB message buffer. */
const batchSize = 50;

/**
 * Fetch tooltips for entries of one kind, as plain text keyed by type. Types the game cannot
 * describe are absent.
 *
 * @throws when the bridge call fails or the mod does not register the function
 */
export async function fetchGameTooltips(kind: TooltipKind, types: string[]): Promise<Map<string, string>> {
  const texts: [string, string][] = [];
  for (let start = 0; start < types.length; start += batchSize) {
    const result = await callTooltips(kind, types.slice(start, start + batchSize));
    for (const [type, text] of Object.entries(result)) {
      if (typeof text === 'string') texts.push([type, text]);
    }
  }
  const tooltips = new Map<string, string>();
  if (texts.length === 0) return tooltips;
  const iconNames = await loadIconNames();
  for (const [type, text] of texts) {
    const stripped = stripTags(nameIcons(text, iconNames))?.trim();
    if (stripped) tooltips.set(type, stripped);
  }
  return tooltips;
}

/** Map each yield and resource icon to its localized name; the first row wins when rows share an icon. */
async function loadIconNames(): Promise<Map<string, string>> {
  const db = gameDatabase.getDatabase();
  const rows = [
    ...await db.selectFrom('Yields').select(['IconString', 'Description']).orderBy('ID').execute(),
    ...await db.selectFrom('Resources').select(['IconString', 'Description']).orderBy('ID').execute(),
  ];
  const names = new Map<string, string>();
  for (const { IconString, Description } of await gameDatabase.localizeObjects(rows)) {
    if (!IconString || !Description || Description.startsWith('TXT_KEY_') || names.has(IconString)) continue;
    names.set(IconString, Description);
  }
  return names;
}

/**
 * Replace icons that stand for a yield or resource with its name, so text such as "+1 [ICON_PRODUCTION]
 * +1 [ICON_GOLD]" keeps which amount is which. An icon whose next word already names it is dropped.
 */
export function nameIcons(text: string, iconNames: Map<string, string>): string {
  return text.replace(/(\[ICON_[A-Z0-9_]+\])([^[\]\n]*)/g, (match, icon: string, after: string, offset: number) => {
    const name = iconNames.get(icon);
    if (!name) return match;
    const separated = offset === 0 || /[\s\]]/.test(text[offset - 1]);
    if (sameWord(firstWord(name), firstWord(after))) return separated ? after.trimStart() : after;
    const space = separated ? '' : ' ';
    return `${space}${name}${after}`;
  });
}

/** The first word of a text, lowercased. */
function firstWord(text: string): string {
  return text.trimStart().split(/[\s:,.;!?()]/, 1)[0].toLowerCase();
}

/** Whether two words match, allowing a plural ending on either one (Horse and Horses). */
function sameWord(a: string, b: string): boolean {
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long === short || long === `${short}s` || long === `${short}es`;
}

/** Call the game function for one batch; when it is not registered yet, ask the mod to register it and retry once. */
async function callTooltips(kind: TooltipKind, types: string[]): Promise<Record<string, unknown>> {
  let response = await bridgeManager.callLuaFunction(gameTooltipFunction, [kind, types]);
  if (!response.success && response.error?.code === 'INVALID_FUNCTION') {
    const registered = await bridgeManager.executeLuaScript(registerScript);
    if (!registered.success) {
      throw new Error(`Could not ask the game to register ${gameTooltipFunction}: ${registered.error?.message ?? 'unknown error'}.`);
    }
    response = await bridgeManager.callLuaFunction(gameTooltipFunction, [kind, types]);
  }
  if (!response.success) {
    const hint = response.error?.code === 'INVALID_FUNCTION' ? ' Is the Vox Deorum mod enabled?' : '';
    throw new Error(`${gameTooltipFunction} failed: ${response.error?.message ?? response.error?.code ?? 'unknown error'}.${hint}`);
  }
  // Lua returns an empty table for an empty map, which may arrive as an array.
  const result = response.result;
  return result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : {};
}
