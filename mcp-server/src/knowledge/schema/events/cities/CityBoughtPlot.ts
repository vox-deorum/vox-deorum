import { z } from 'zod';

/**
 * Schema for the CityBoughtPlot event
 * Triggered when a city acquires a new plot of land through various acquisition methods
 */
export const CityBoughtPlot = z.object({
  /** The ID of the player who owns the city acquiring the plot */
  PlayerID: z.number(),
  
  /** The unique identifier of the city acquiring the plot */
  CityID: z.number(),
  
  /** The X coordinate of the plot being acquired */
  PlotX: z.number(),
  
  /** The Y coordinate of the plot being acquired */
  PlotY: z.number(),
  
  /** True if the plot was purchased with gold, false otherwise */
  WithGold: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
  
  /** True if the plot was acquired via cultural expansion, false if via gold purchase */
  WithFaithCulture: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false)
});