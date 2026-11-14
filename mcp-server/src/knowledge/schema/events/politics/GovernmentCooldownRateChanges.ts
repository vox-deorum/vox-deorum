import { z } from 'zod';

/**
 * Event triggered when a player's government cooldown rate modifier changes.
 * The rate affects how quickly the government cooldown period decreases each turn.
 */
export const GovernmentCooldownRateChanges = z.object({
  /** The unique identifier of the player whose government cooldown rate has changed */
  PlayerID: z.number(),
  
  /** The amount by which the cooldown rate is being modified (positive speeds up, negative slows down) */
  RateChangeValue: z.number()
});