import { z } from 'zod';

/**
 * Event triggered when a tile's improvement is built, destroyed, changed, or has its pillage state modified
 */
export const TileImprovementChanged = z.object({
  /** The X coordinate of the tile where the improvement changed */
  PlotX: z.number(),
  /** The Y coordinate of the tile where the improvement changed */
  PlotY: z.number(),
  /** The player ID of the tile's current owner (if any) */
  OwnerID: z.number(),
  /** The type/ID of the previous improvement (NO_IMPROVEMENT if none) */
  OldImprovementType: z.number(),
  /** The type/ID of the new improvement (NO_IMPROVEMENT if removed) */
  NewImprovementType: z.number(),
  /** Whether the improvement is currently in a pillaged state */
  IsPillaged: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
});