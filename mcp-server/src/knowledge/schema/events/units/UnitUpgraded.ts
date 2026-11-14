import { z } from 'zod';

/**
 * Event triggered when a unit is upgraded to a more advanced unit type
 */
export const UnitUpgraded = z.object({
  /** The ID of the player who owns the units being upgraded */
  PlayerID: z.number(),
  /** The ID of the original unit before the upgrade */
  OldUnitID: z.number(),
  /** The ID of the new unit after the upgrade */
  NewUnitID: z.number(),
  /** Whether this upgrade came from a goody hut (true) or standard upgrade mechanics (false) */
  IsGoodyHut: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
});