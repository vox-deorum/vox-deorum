import { z } from 'zod';

/**
 * Schema for the PlayerGoldenAge event.
 * Triggered when a player's Golden Age status changes (starting or ending).
 */
export const PlayerGoldenAge = z.object({
  /** The ID of the player whose Golden Age status changed */
  PlayerID: z.number(),
  
  /** Whether the Golden Age is starting (true) or ending (false) */
  Starting: z.union([z.number(), z.boolean()]).transform((arg) => arg === 1),
  
  /** The number of turns being added/subtracted (0 when ending) */
  TurnChange: z.number()
});