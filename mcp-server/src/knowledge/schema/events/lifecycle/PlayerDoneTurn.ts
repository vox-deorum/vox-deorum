import { z } from 'zod';

/**
 * Schema for the PlayerDoneTurn event
 * Triggered when a player finishes their turn during the turn ending phase
 */
export const PlayerDoneTurn = z.object({
  /** The ID of the player whose turn is ending */
  PlayerID: z.number(),
  /** The ID of the player whose turn is coming next */
  NextPlayerID: z.number()
});