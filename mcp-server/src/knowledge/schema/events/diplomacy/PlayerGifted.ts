import { z } from 'zod';

/**
 * Schema for the PlayerGifted event triggered when a major civilization gives gifts to a minor civilization
 */
export const PlayerGifted = z.object({
  /** The ID of the major civilization giving the gift */
  GivingPlayerID: z.number(),
  
  /** The ID of the minor civilization receiving the gift */
  ReceivingPlayerID: z.number(),
  
  /** Amount of gold given (-1 for non-gold gifts) */
  GoldAmount: z.number(),
  
  /** Type of unit given (-1 for non-unit gifts) */
  UnitType: z.number(),
  
  /** X coordinate of tile improvement (-1 for non-tile gifts) */
  PlotX: z.number(),
  
  /** Y coordinate of tile improvement (-1 for non-tile gifts) */
  PlotY: z.number()
});