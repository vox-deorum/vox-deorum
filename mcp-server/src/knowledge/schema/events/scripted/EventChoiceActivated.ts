import { z } from 'zod';

/**
 * Schema for the EventChoiceActivated event
 * Triggered when a player is presented with choices for a player-level event
 */
export const EventChoiceActivated = z.object({
  /** The ID of the player who is making the event choice */
  PlayerID: z.number(),
  
  /** The identifier of the specific event choice being activated */
  EventChoiceID: z.number()
});