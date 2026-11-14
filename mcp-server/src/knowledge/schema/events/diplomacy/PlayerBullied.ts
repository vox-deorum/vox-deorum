import { z } from 'zod';

/**
 * Schema for the PlayerBullied event.
 * Triggered when a major civilization successfully bullies a city-state into providing tribute or resources.
 */
export const PlayerBullied = z.object({
  /** The ID of the major civilization performing the bullying */
  BullyingPlayerID: z.number(),
  
  /** The ID of the minor civilization (city-state) being bullied */
  MinorPlayerID: z.number(),
  
  /** Amount of tribute extracted (gold amount for both gold and science tribute, or -1 for unit tribute) */
  Amount: z.number(),
  
  /** Type of unit provided (or -1 if not applicable) */
  UnitType: z.number(),
  
  /** X coordinate of provided unit (or -1 if not applicable) */
  PlotX: z.number(),
  
  /** Y coordinate of provided unit (or -1 if not applicable) */
  PlotY: z.number(),
  
  /** Context of the bullying action (YIELD_GOLD, YIELD_SCIENCE, or -1 for units) */
  YieldType: z.number()
});