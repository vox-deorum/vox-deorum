import { z } from 'zod';

/**
 * Triggered when a player adopts their first state religion, transitioning from having no official state religion to establishing one.
 * This represents a major religious and governmental decision that affects the entire civilization through official religious endorsement and associated bonuses.
 */
export const StateReligionAdopted = z.object({
  /** The unique identifier of the player adopting the state religion */
  PlayerID: z.number(),
  
  /** The religion being adopted as the official state faith */
  NewReligionID: z.number(),
  
  /** The previous state religion (should be NO_RELIGION for this event) */
  OldReligionID: z.number()
});