import { z } from 'zod';

/**
 * Schema for CityInvestedUnit event
 * Triggered when a city invests in a specific unit class to reduce production costs
 */
export const CityInvestedUnit = z.object({
  /** The ID of the player who owns the city making the unit investment */
  PlayerID: z.number(),
  
  /** The unique identifier of the city where the unit investment is made */
  CityID: z.number(),
  
  /** The unit class identifier for the type of units being invested in */
  UnitClass: z.number(),
  
  /** Whether the investment is being activated (true) or deactivated (false) */
  Invested: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false)
});