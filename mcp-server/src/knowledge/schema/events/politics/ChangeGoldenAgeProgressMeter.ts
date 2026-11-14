import { z } from 'zod';

/**
 * Schema for the ChangeGoldenAgeProgressMeter event.
 * Triggered when a player's progress towards their next Golden Age is modified.
 */
export const ChangeGoldenAgeProgressMeter = z.object({
  /** The ID of the player whose Golden Age progress meter is being changed */
  PlayerID: z.number(),
  
  /** The amount by which the Golden Age progress meter is being modified (must be positive) */
  Change: z.number()
});