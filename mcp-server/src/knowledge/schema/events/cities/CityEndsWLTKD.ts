import { z } from 'zod';

/**
 * Schema for the CityEndsWLTKD event.
 * Triggered when a city's "We Love The King Day" celebration period comes to an end.
 */
export const CityEndsWLTKD = z.object({
  /** The ID of the player who owns the city */
  OwnerID: z.number(),
  /** The X coordinate of the city on the game map */
  PlotX: z.number(),
  /** The Y coordinate of the city on the game map */
  PlotY: z.number(),
  /** An unused parameter, always set to 0 */
  Unused: z.number()
});