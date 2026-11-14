import { z } from 'zod';

/**
 * Schema for the CityConvertsReligion event
 * Triggered when a city undergoes religious changes
 */
export const CityConvertsReligion = z.object({
  /** The ID of the player who owns the city */
  OwnerID: z.number(),
  /** The type of religion that has become the new majority */
  ReligionID: z.number(),
  /** The X coordinate of the city on the game map */
  CityX: z.number(),
  /** The Y coordinate of the city on the game map */
  CityY: z.number()
});