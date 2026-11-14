import { z } from 'zod';

/**
 * Schema for the CityBeginsWLTKD event
 * Triggered when a city begins a "We Love The King Day" (WLTKD) celebration
 */
export const CityBeginsWLTKD = z.object({
  /** The ID of the player who owns the city beginning WLTKD */
  PlayerID: z.number(),
  /** The X coordinate of the city on the game map */
  CityX: z.number(),
  /** The Y coordinate of the city on the game map */
  CityY: z.number(),
  /** The number of turns being added to the WLTKD counter */
  Change: z.number()
});