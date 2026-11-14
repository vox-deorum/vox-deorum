import { z } from 'zod';

/**
 * Schema for the ElectionResultSuccess event
 * Triggered when a spy successfully rigs elections in a minor civilization
 */
export const ElectionResultSuccess = z.object({
  /** The unique identifier of the player whose spy successfully rigged the election */
  PlayerID: z.number(),
  /** The unique identifier of the spy that performed the successful operation */
  SpyID: z.number(),
  /** The value or benefit gained from the successful election rigging operation */
  Value: z.number(),
  /** The X coordinate of the minor civilization's capital city where the operation succeeded */
  CityX: z.number(),
  /** The Y coordinate of the minor civilization's capital city where the operation succeeded */
  CityY: z.number(),
});