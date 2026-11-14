import { z } from 'zod';

/**
 * Event triggered when a player changes their state religion from one established religion to another.
 * This represents a major shift in governmental religious policy.
 */
export const StateReligionChanged = z.object({
  /** The unique identifier of the player changing their state religion */
  PlayerID: z.number(),
  
  /** The religion being adopted as the new official state faith */
  NewReligionID: z.number(),
  
  /** The previously established state religion being abandoned */
  OldReligionID: z.number(),
});