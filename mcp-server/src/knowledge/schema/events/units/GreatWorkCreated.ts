import { z } from 'zod';

/**
 * Schema for the GreatWorkCreated event
 * Triggered when a Great Person successfully creates a Great Work
 */
export const GreatWorkCreated = z.object({
  /** The unique identifier of the player who owns the Great Person that created the work */
  PlayerID: z.number(),
  
  /** The unique identifier of the Great Person unit that created the Great Work */
  UnitID: z.number(),
  
  /** The integer representation of the Great Work type that was created */
  GreatWorkType: z.number()
});