import { z } from 'zod';

/**
 * Schema for the CityInvestedBuilding event.
 * Triggered when a city invests in a specific building type to reduce its production cost.
 */
export const CityInvestedBuilding = z.object({
  /** The ID of the player who owns the city making the building investment */
  PlayerID: z.number(),
  
  /** The unique identifier of the city where the building investment is made */
  CityID: z.number(),
  
  /** The building class identifier for the type of building being invested in */
  BuildingClass: z.number(),
  
  /** Whether the investment is being activated (true) or deactivated (false) */
  Invested: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false)
});