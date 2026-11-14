import { z } from "zod";

/**
 * Schema for the CityExtendsWLTKD event.
 * Triggered when a city's "We Love The King Day" (WLTKD) celebration is extended while already active.
 */
export const CityExtendsWLTKD = z.object({
  /** The ID of the player who owns the city extending WLTKD */
  PlayerID: z.number(),
  /** The X coordinate of the city on the game map */
  CityX: z.number(),
  /** The Y coordinate of the city on the game map */
  CityY: z.number(),
  /** The number of turns being added to the existing WLTKD counter */
  Change: z.number()
});