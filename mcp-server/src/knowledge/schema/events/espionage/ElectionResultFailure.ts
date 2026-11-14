import { z } from 'zod';

/**
 * Schema for the ElectionResultFailure event
 * Triggered when a spy's attempt to rig elections in a minor civilization fails
 */
export const ElectionResultFailure = z.object({
  /** The unique identifier of the player whose spy attempted the election rigging */
  PlayerID: z.number(),
  
  /** The unique identifier of the spy that failed the operation */
  SpyID: z.number(),
  
  /** The amount by which the player's influence with the minor civilization is reduced due to the failure */
  DiminishAmount: z.number(),
  
  /** The X coordinate of the minor civilization's capital city where the operation failed */
  CapitalX: z.number(),
  
  /** The Y coordinate of the minor civilization's capital city where the operation failed */
  CapitalY: z.number()
});