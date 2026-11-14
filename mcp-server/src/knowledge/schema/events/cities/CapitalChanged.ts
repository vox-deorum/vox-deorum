import { z } from 'zod';

/**
 * Schema for the CapitalChanged event
 * Fired whenever a civilization's capital city is changed or established
 */
export const CapitalChanged = z.object({
  /** The player ID whose capital is changing */
  PlayerID: z.number(),
  /** The city ID of the new capital city */
  NewCapitalCityID: z.number(),
  /** The city ID of the previous capital city, or -1 if no previous capital existed */
  OldCapitalCityID: z.number()
});