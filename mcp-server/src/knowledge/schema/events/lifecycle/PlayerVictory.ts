import { z } from 'zod';

/**
 * Schema for the PlayerVictory event
 * Triggered when a player achieves victory.
 */
export const PlayerVictory = z.object({
  /** The ID of the player who won */
  PlayerID: z.number(),
  /** The type of victory it achieves */
  VictoryType: z.number()
});