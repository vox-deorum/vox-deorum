import { z } from 'zod';

/**
 * Schema for the UnitPromoted event
 * Triggered when a unit receives a promotion, gaining new abilities or bonuses
 */
export const UnitPromoted = z.object({
  /** The ID of the player who owns the promoted unit */
  PlayerID: z.number(),
  /** The unique identifier of the unit that received the promotion */
  UnitID: z.number(),
  /** The identifier of the promotion that was granted to the unit */
  PromotionType: z.number(),
});