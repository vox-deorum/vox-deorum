import { z } from 'zod';

/**
 * Schema for PlayerEndTurnCompleted event
 * Triggered at the very end of a player's turn processing, after all turn mechanics have been completed
 */
export const PlayerEndTurnCompleted = z.object({
  /** The ID of the player whose turn has completed */
  PlayerID: z.number(),
});