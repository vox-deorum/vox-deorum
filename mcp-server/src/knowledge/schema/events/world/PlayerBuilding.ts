import { z } from "zod";

/**
 * Schema for PlayerBuilding event - triggered when a unit begins or continues work on a terrain improvement or construction project
 */
export const PlayerBuilding = z.object({
  /** The ID of the player who owns the building unit */
  OwnerID: z.number(),
  
  /** The unique identifier of the unit performing the construction */
  UnitID: z.number(),
  
  /** The X coordinate of the tile being improved */
  PlotX: z.number(),
  
  /** The Y coordinate of the tile being improved */
  PlotY: z.number(),
  
  /** The type of improvement or construction being performed */
  BuildType: z.number(),
  
  /** Whether this is the first time work has begun on this project */
  IsFirstTime: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false)
});