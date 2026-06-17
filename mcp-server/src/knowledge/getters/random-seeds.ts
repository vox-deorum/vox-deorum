/**
 * Getter for Civ V's pregame random seed values.
 *
 * These values come from CvPreGame, not the live RNG objects. That distinction
 * matters because live RNG seeds are mutable state, while pregame seeds are the
 * reproducibility inputs that Civ read from config.ini.
 */

import * as z from 'zod';
import { LuaFunction } from '../../bridge/lua-function.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('RandomSeeds');

export const RandomSeedsSchema = z.object({
  SyncRandSeed: z.number(),
  MapRandSeed: z.number()
});

export type RandomSeeds = z.infer<typeof RandomSeedsSchema>;

let luaFuncInstance: LuaFunction | undefined;
/** Lazily constructed so the (file-reading) init runs on first use, not at import. */
const luaFunc = () => (luaFuncInstance ??= LuaFunction.fromFile(
  'get-random-seeds.lua',
  'getRandomSeeds',
  []
));

export async function getRandomSeeds(): Promise<RandomSeeds | undefined> {
  const response = await luaFunc().execute();
  if (!response.success) {
    logger.warn('Failed to retrieve Civ random seeds', response.error);
    return undefined;
  }

  const parsed = RandomSeedsSchema.safeParse(response.result);
  if (!parsed.success) {
    logger.warn('Civ random seed response had unexpected shape', parsed.error);
    return undefined;
  }

  return parsed.data;
}
