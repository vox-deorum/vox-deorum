import { z } from 'zod';

/**
 * ReligionReformed event - Triggered when a player adds a Reformation belief to their religion
 */
export const ReligionReformed = z.object({
  /** The unique identifier of the player adding the Reformation belief */
  PlayerID: z.number(),
  /** The specific religion being reformed with the new belief */
  ReligionID: z.number(),
  /** The Reformation belief being added to the religion */
  ReformationBelief: z.number(),
});