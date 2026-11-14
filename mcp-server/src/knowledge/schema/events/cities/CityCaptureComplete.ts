import { z } from 'zod';

/**
 * Schema for the CityCaptureComplete event.
 * Triggered when a city has been successfully transferred from one player to another.
 */
export const CityCaptureComplete = z.object({
  /** The player ID of the city's previous owner */
  OldOwnerID: z.number(),
  
  /** True if the captured city was a capital city */
  IsCapital: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
  
  /** The X coordinate of the captured city */
  CityX: z.number(),
  
  /** The Y coordinate of the captured city */
  CityY: z.number(),
  
  /** The player ID of the city's new owner (the acquiring player) */
  NewOwnerID: z.number(),
  
  /** The population of the city at the time of capture */
  Population: z.number(),
  
  /** True if the city was taken through military conquest */
  IsConquest: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
  
  /** Total number of Great Works that were in the city */
  TotalGreatWorks: z.number(),
  
  /** Number of Great Works successfully transferred to the new owner */
  CapturedGreatWorks: z.number()
});