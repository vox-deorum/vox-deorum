import { z } from 'zod';

/**
 * Schema for the IdeologySwitched event
 * Triggered when a player switches from one ideology to another through an ideological revolution
 */
export const IdeologySwitched = z.object({
  /** The unique identifier of the player switching ideologies */
  PlayerID: z.number(),
  
  /** The policy branch type identifier of the ideology being abandoned */
  OldBranchType: z.number(),
  
  /** The policy branch type identifier of the ideology being adopted */
  NewBranchType: z.number()
});