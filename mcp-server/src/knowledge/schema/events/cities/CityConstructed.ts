import { z } from 'zod';

/**
 * Schema for the CityConstructed event
 * Triggered when a city completes construction of a building through production, gold purchase, or faith purchase
 */
export const CityConstructed = z.object({
  /** The ID of the player who owns the city */
  OwnerID: z.number(),
  
  /** The unique identifier of the city */
  CityID: z.number(),
  
  /** The type of building that was constructed */
  BuildingType: z.number(),
  
  /** Whether the building was purchased with gold (true) or produced normally/with faith (false) */
  IsGoldPurchase: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
  
  /** Whether the building was purchased with faith (true) or produced normally/with gold (false) */
  IsFaithPurchase: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false)
});