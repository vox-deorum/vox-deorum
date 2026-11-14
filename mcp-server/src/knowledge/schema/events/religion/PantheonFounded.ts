import { z } from 'zod';

/**
 * Schema for the PantheonFounded event
 * Triggered when a player successfully founds a pantheon by accumulating enough Faith points
 */
export const PantheonFounded = z.object({
  /** The unique identifier of the player founding the pantheon */
  PlayerID: z.number(),
  
  /** The unique identifier of the player's capital city */
  CityID: z.number(),
  
  /** Fixed identifier indicating this is a pantheon (RELIGION_PANTHEON) */
  ReligionType: z.number(),
  
  /** The specific pantheon belief being adopted */
  BeliefType: z.number()
});