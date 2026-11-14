import { z } from 'zod';

/**
 * Triggered when a natural feature on a tile is added, removed, or modified
 */
export const TileFeatureChanged = z.object({
  /** The X coordinate of the tile where the feature changed */
  PlotX: z.number(),
  /** The Y coordinate of the tile where the feature changed */
  PlotY: z.number(),
  /** The player ID of the tile's current owner (if any) */
  OwnerID: z.number(),
  /** The type/ID of the previous feature (NO_FEATURE if none) */
  OldFeatureID: z.number(),
  /** The type/ID of the new feature (NO_FEATURE if removed) */
  NewFeatureID: z.number(),
});