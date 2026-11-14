import { z } from 'zod';

/**
 * Schema for the PlayerBuilt event, triggered when a unit successfully completes
 * construction of a terrain improvement or building project.
 */
export const PlayerBuilt = z.object({
  /** The ID of the player who owns the unit that completed construction */
  OwnerID: z.number(),
  /** The unique identifier of the unit that finished the building work */
  UnitID: z.number(),
  /** The X coordinate of the tile where construction was completed */
  PlotX: z.number(),
  /** The Y coordinate of the tile where construction was completed */
  PlotY: z.number(),
  /** The type of improvement or construction that was completed */
  BuildType: z.number()
});