import { z } from 'zod';

/**
 * Schema for the PlayerAdoptPolicy event
 * Triggered when a player adopts a new policy through the social policy system
 */
export const PlayerAdoptPolicy = z.object({
  /** The ID of the player who adopted the policy */
  PlayerID: z.number(),
  /** The type of policy that was adopted */
  PolicyID: z.number()
});