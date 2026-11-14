import { z } from 'zod';

/**
 * Event triggered when a player successfully enhances their founded religion by adding enhancer beliefs.
 * Religion enhancement is the second major step in religious development, occurring after founding a religion.
 */
export const ReligionEnhanced = z.object({
  /** The unique identifier of the player enhancing the religion */
  PlayerID: z.number(),
  
  /** The specific religion being enhanced */
  ReligionID: z.number(),
  
  /** The first enhancer belief being added */
  FirstEnhancerBelief: z.number(),
  
  /** The second enhancer belief being added */
  SecondEnhancerBelief: z.number(),
});