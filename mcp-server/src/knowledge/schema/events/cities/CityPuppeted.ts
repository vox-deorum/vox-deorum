import { z } from 'zod';

/**
 * Schema for the CityPuppeted event.
 * Triggered when a city is converted into a puppet state, typically after capture.
 */
export const CityPuppeted = z.object({
  /** The ID of the player who owns the city being converted to puppet status */
  PlayerID: z.number(),
  
  /** The unique identifier of the city being converted to puppet status */
  CityID: z.number()
});