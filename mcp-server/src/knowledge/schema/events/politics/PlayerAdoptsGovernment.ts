import { z } from 'zod';

/**
 * Schema for the PlayerAdoptsGovernment event
 * Triggered when a player adopts a new government type or changes their current governmental system
 */
export const PlayerAdoptsGovernment = z.object({
  /** The ID of the player who adopted the government */
  PlayerID: z.number(),
  /** The ID/type of the government that was adopted */
  GovernmentType: z.number()
});