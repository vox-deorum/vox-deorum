import { z } from 'zod';

/**
 * Schema for the CityTrained event
 * Triggered when a city completes training, purchases, or recruits a unit
 */
export const CityTrained = z.object({
  /** The ID of the player who owns the city creating the unit */
  PlayerID: z.number(),
  
  /** The unique identifier of the city where the unit is being trained */
  CityID: z.number(),
  
  /** The unique identifier of the newly created unit */
  UnitID: z.number(),
  
  /** Whether the unit was purchased with gold rather than produced */
  WithGold: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
  
  /** Whether the unit was recruited with faith points */
  WithFaith: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false)
});