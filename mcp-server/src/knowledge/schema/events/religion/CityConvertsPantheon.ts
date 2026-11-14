import { z } from 'zod';

/**
 * Schema for the CityConvertsPantheon event.
 * Triggered when a city converts to following a pantheon belief system.
 */
export const CityConvertsPantheon = z.object({
  /** The ID of the player who owns the city */
  OwnerID: z.number(),
  /** The X coordinate of the city on the game map */
  CityX: z.number(),
  /** The Y coordinate of the city on the game map */
  CityY: z.number()
});