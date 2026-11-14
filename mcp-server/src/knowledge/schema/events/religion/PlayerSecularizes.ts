import { z } from 'zod';

/**
 * Event triggered when a player's secularization status changes
 * Captures when a civilization transitions to or from a secularized state
 */
export const PlayerSecularizes = z.object({
  /** The unique identifier of the player whose secularization status is changing */
  PlayerID: z.number(),
  
  /** The player's current state religion at the time of secularization change */
  StateReligion: z.number(),
  
  /** The new secularization status (true = secularizing, false = ending secularization) */
  IsSecularizing: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false)
});