/**
 * Fetch the game's own tooltips for database entries through the Vox Deorum mod's
 * `VoxDeorumReferenceTooltips` function (civ5-mod/Lua/VoxDeorumReference.lua), which builds
 * player-agnostic text with the same tooltip code the in-game screens use.
 */

import { bridgeManager } from '../../server.js';
import { stripTags } from './localized.js';

/** Entry kinds the game function can describe. */
export type TooltipKind = 'unit' | 'building' | 'technology';

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
  const tooltips = new Map<string, string>();
  for (let start = 0; start < types.length; start += batchSize) {
    const result = await callTooltips(kind, types.slice(start, start + batchSize));
    for (const [type, text] of Object.entries(result)) {
      const stripped = typeof text === 'string' ? stripTags(text)?.trim() : undefined;
      if (stripped) tooltips.set(type, stripped);
    }
  }
  return tooltips;
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
