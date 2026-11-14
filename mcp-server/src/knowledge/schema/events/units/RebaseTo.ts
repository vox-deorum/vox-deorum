import { z } from 'zod';

/**
 * RebaseTo event - Triggered when an air unit successfully executes a rebase operation
 */
export const RebaseTo = z.object({
  /** The ID of the player who owns the unit performing the rebase */
  PlayerID: z.number(),
  /** The unique identifier of the unit that is rebasing */
  UnitID: z.number(),
  /** The X coordinate of the destination tile for the rebase */
  PlotX: z.number(),
  /** The Y coordinate of the destination tile for the rebase */
  PlotY: z.number(),
});