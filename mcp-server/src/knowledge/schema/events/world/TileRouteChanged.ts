import { z } from 'zod';

/**
 * Event triggered when a transportation route (road or railroad) on a tile is built, destroyed, or has its pillage state modified
 */
export const TileRouteChanged = z.object({
  /** The X coordinate of the tile where the route changed */
  PlotX: z.number(),
  /** The Y coordinate of the tile where the route changed */
  PlotY: z.number(),
  /** The player ID of the tile's current owner (if any) */
  OwnerID: z.number(),
  /** The type/ID of the previous route (NO_ROUTE if none) */
  OldRoute: z.number(),
  /** The type/ID of the new route (NO_ROUTE if removed) */
  NewRoute: z.number(),
  /** Whether the route is currently in a pillaged state */
  IsPillaged: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
});