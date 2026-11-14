import { z } from 'zod';

/**
 * Schema for the GovernmentCooldownChanges event.
 * Triggered whenever a player's government adoption cooldown period is modified.
 */
export const GovernmentCooldownChanges = z.object({
  /** The unique identifier of the player whose government cooldown has changed */
  PlayerID: z.number(),
  
  /** The current cooldown value in turns remaining before the player can adopt a new government */
  CurrentCooldown: z.number(),
});