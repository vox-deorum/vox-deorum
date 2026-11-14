import { z } from 'zod';

/**
 * Schema for the CitySoldBuilding event
 * Triggered when a player sells a building in one of their cities
 */
export const CitySoldBuilding = z.object({
  /** The ID of the player who is selling the building */
  PlayerID: z.number(),
  
  /** The unique identifier of the city where the building is being sold */
  CityID: z.number(),
  
  /** The building type identifier for the specific building being sold */
  BuildingType: z.number()
});