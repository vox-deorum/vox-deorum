import { z } from 'zod';

/**
 * SetPopulation event - triggered when a city's population changes through the Lua scripting system
 */
export const SetPopulation = z.object({
  /** The X coordinate of the city whose population changed */
  CityX: z.number(),
  /** The Y coordinate of the city whose population changed */
  CityY: z.number(),
  /** The previous population value */
  OldPopulation: z.number(),
  /** The current population value after the change */
  NewPopulation: z.number(),
});