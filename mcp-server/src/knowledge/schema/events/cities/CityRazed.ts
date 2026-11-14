import { z } from 'zod';

/**
 * Schema for the CityRazed event
 * Triggered when a city is completely destroyed (disbanded) in Civilization V
 */
export const CityRazed = z.object({
  /** The ID of the player who owns the city being razed */
  PlayerID: z.number().int(),
  
  /** The X coordinate of the city plot being razed */
  CityX: z.number().int(),
  
  /** The Y coordinate of the city plot being razed */
  CityY: z.number().int(),
});