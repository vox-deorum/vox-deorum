import { z } from "zod";

/**
 * Triggered when a unit (typically a Settler) successfully founds a new city
 */
export const UnitCityFounded = z.object({
  /** The ID of the player who owns the unit that founded the city */
  PlayerID: z.number(),
  /** The unique identifier of the unit that founded the city */
  UnitID: z.number(),
  /** The type identifier of the unit that founded the city */
  UnitType: z.number(),
  /** The X coordinate where the city was founded */
  PlotX: z.number(),
  /** The Y coordinate where the city was founded */
  PlotY: z.number(),
});