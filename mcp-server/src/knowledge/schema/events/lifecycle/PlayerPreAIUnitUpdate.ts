import { z } from "zod";

/**
 * Schema for the PlayerPreAIUnitUpdate event
 * Triggered just before the AI player performs unit updates during their turn
 */
export const PlayerPreAIUnitUpdate = z.object({
  /** The unique identifier of the AI player about to perform unit updates */
  PlayerID: z.number(),
});