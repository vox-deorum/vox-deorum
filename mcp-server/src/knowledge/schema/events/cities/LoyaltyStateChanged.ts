import { z } from 'zod';

/**
 * Schema for the LoyaltyStateChanged event
 * Triggered when a city's loyalty state changes in the Community Balance Patch's loyalty system
 */
export const LoyaltyStateChanged = z.object({
  /** The player who owns the city */
  PlayerID: z.number(),
  /** The unique identifier of the city whose loyalty changed */
  CityID: z.number(),
  /** The previous loyalty state value */
  OldLoyaltyState: z.number(),
  /** The current loyalty state value */
  NewLoyaltyState: z.number()
});