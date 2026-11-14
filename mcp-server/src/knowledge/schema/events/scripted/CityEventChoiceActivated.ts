import { z } from 'zod';

/**
 * Schema for CityEventChoiceActivated event
 * Triggered when a player makes a specific choice in response to a city event
 */
export const CityEventChoiceActivated = z.object({
  /** The ID of the player who owns the city making the event choice */
  PlayerID: z.number(),
  /** The unique identifier of the city where the event choice is being made */
  CityID: z.number(),
  /** The identifier of the specific event choice being activated */
  ChoiceID: z.number()
});