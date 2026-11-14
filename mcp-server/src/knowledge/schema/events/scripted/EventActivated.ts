import { z } from 'zod';

/**
 * Schema for the EventActivated event data.
 * Triggered when a player-level event begins in Civilization V.
 */
export const EventActivated = z.object({
  /** The ID of the player for whom the event is activated */
  PlayerID: z.number(),
  /** The identifier of the specific player event being activated */
  EventID: z.number()
});