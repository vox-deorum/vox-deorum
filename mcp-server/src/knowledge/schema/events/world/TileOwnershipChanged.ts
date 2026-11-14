import { z } from 'zod';

/**
 * Event triggered when a tile's ownership changes from one player to another
 */
export const TileOwnershipChanged = z.object({
  /** The X coordinate of the tile that changed ownership */
  PlotX: z.number(),
  /** The Y coordinate of the tile that changed ownership */
  PlotY: z.number(),
  /** The player ID of the new owner (NO_PLAYER if becoming neutral) */
  NewOwnerID: z.number(),
  /** The player ID of the previous owner (NO_PLAYER if was neutral) */
  OldOwnerID: z.number(),
});