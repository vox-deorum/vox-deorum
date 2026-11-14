import { z } from "zod";

/**
 * Event triggered when a unit's position is changed to new coordinates on the map
 */
export const UnitSetXY = z.object({
  /** The ID of the player who owns the unit being positioned */
  PlayerID: z.number(),
  /** The unique identifier of the unit whose position is being set */
  UnitID: z.number(),
  /** The new X coordinate where the unit is being placed */
  PlotX: z.number(),
  /** The new Y coordinate where the unit is being placed */
  PlotY: z.number(),
});