import { z } from 'zod';

/**
 * Schema for CityEventChoiceEnded event.
 * Triggered when a city event choice's duration expires or is manually cancelled.
 */
export const CityEventChoiceEnded = z.object({
  /** The ID of the player who owns the city where the event choice is ending */
  PlayerID: z.number(),
  /** The unique identifier of the city where the event choice is concluding */
  CityID: z.number(),
  /** The identifier of the specific event choice that is ending */
  ChoiceID: z.number(),
});