import { z } from 'zod';

/**
 * Event triggered when a player's reform cooldown rate modifier is changed
 */
export const ReformCooldownRateChanges = z.object({
  /** The unique identifier of the player whose reform cooldown rate has changed */
  PlayerID: z.number(),
  /** The value being processed (either the change amount or the new absolute value) */
  Value: z.number()
});