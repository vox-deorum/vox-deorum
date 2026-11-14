import { z } from 'zod';

/**
 * Schema for the CityPrepared event.
 * Triggered during end-of-turn processing when a city's specialists generate Great Person Points.
 */
export const CityPrepared = z.object({
  /** The ID of the player who owns the city generating Great Person Points */
  PlayerID: z.number(),
  
  /** Pointer to the city object where specialists are generating GPP */
  CityPtr: z.any(),
  
  /** The type of specialist generating the Great Person Points */
  SpecialistType: z.number(),
  
  /** The amount of Great Person Points being generated this turn */
  GppChange: z.number(),
  
  /** The total GPP required to spawn a Great Person of this type */
  GppThreshold: z.number()
});