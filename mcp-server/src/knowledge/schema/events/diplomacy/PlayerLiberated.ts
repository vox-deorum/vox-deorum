import { z } from 'zod';

/**
 * Schema for the PlayerLiberated event.
 * Triggered when a player liberates a city that belongs to a previously conquered civilization.
 */
export const PlayerLiberated = z.object({
  /** The ID of the player performing the liberation */
  LiberatingPlayerID: z.number(),
  /** The ID of the player being liberated */
  LiberatedPlayerID: z.number(),
  /** The ID of the newly liberated city */
  CityID: z.number()
});