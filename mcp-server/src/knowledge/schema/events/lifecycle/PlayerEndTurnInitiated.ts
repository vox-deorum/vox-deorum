import { z } from 'zod';

/**
 * Schema for the PlayerEndTurnInitiated event.
 * Triggered when a player begins the turn ending phase.
 */
export const PlayerEndTurnInitiated = z.object({
  /** The ID of the player whose turn is ending */
  PlayerID: z.number(),
});