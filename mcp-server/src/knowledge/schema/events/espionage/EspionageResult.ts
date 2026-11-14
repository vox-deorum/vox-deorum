import { z } from 'zod';

/**
 * Schema for the EspionageResult event
 * Triggered when an espionage operation concludes and produces a result
 */
export const EspionageResult = z.object({
  /** The unique identifier of the player who owns the spy conducting the operation */
  SpyOwnerID: z.number(),
  
  /** The index identifier of the specific spy performing the operation */
  SpyIndex: z.number(),
  
  /** The numerical result or outcome code of the espionage operation */
  SpyResult: z.number(),
  
  /** The X coordinate of the city where the espionage operation took place */
  CityX: z.number(),
  
  /** The Y coordinate of the city where the espionage operation took place */
  CityY: z.number(),
});