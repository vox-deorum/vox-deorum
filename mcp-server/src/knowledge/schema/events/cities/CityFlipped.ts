import { z } from 'zod';

/**
 * Schema for the CityFlipped event triggered when a city revolts and changes ownership due to unhappiness
 */
export const CityFlipped = z.object({
  /** The ID of the city that is flipping/revolting */
  CityID: z.number(),
  
  /** The player ID of the recipient who will receive the city */
  NewOwnerID: z.number(),
  
  /** The player ID of the current owner who is losing the city */
  OldOwnerID: z.number()
});