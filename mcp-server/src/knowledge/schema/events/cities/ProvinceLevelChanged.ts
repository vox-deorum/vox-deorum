import { z } from 'zod';

/**
 * Schema for the ProvinceLevelChanged event
 * Triggered when a city's province level changes in the Community Balance Patch system
 */
export const ProvinceLevelChanged = z.object({
  /** The player who owns the city */
  PlayerID: z.number(),
  /** The unique identifier of the city whose province level changed */
  CityID: z.number(),
  /** The previous province level value */
  OldProvinceLevel: z.number(),
  /** The current province level value */
  NewProvinceLevel: z.number()
});