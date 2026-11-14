import { z } from 'zod';

/**
 * Schema for the PlayerAdoptsCurrency event
 * Triggered when a player changes their active currency system
 */
export const PlayerAdoptsCurrency = z.object({
  /** The ID of the player whose currency changed */
  PlayerID: z.number(),
  /** The ID of the currency being adopted */
  NewCurrency: z.number(),
  /** The ID of the previous currency (-1 if no previous currency existed) */
  OldCurrency: z.number()
});