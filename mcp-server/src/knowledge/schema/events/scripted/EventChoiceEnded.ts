import { z } from 'zod';

/**
 * Schema for EventChoiceEnded event
 * Triggered when a player-level event choice expires or is cancelled
 */
export const EventChoiceEnded = z.object({
  /** The ID of the player whose event choice expired or was cancelled */
  PlayerID: z.number(),
  /** The identifier of the specific event choice that expired or was cancelled */
  EventChoiceID: z.number()
});