import { z } from 'zod';

/**
 * Event triggered when a player's reform cooldown period is modified.
 * This cooldown governs the frequency at which civilizations can enact reforms within their governmental or religious systems.
 */
export const ReformCooldownChanges = z.object({
  /** The unique identifier of the player whose reform cooldown has changed */
  PlayerID: z.number(),
  /** The current cooldown value in turns remaining before the player can enact new reforms */
  CurrentCooldown: z.number(),
});