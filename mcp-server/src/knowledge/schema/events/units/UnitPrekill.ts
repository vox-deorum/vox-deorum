import { z } from 'zod';

/**
 * Event triggered just before a unit is about to be killed or removed from the game
 */
export const UnitPrekill = z.object({
  /** The ID of the player who owns the unit about to be killed */
  OwnerID: z.number(),
  /** The unique identifier of the unit about to be killed */
  UnitID: z.number(),
  /** The type identifier of the unit about to be killed */
  UnitType: z.number(),
  /** The X coordinate of the unit's current location */
  PlotX: z.number(),
  /** The Y coordinate of the unit's current location */
  PlotY: z.number(),
  /** Whether the kill operation should be delayed */
  DelayKill: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
  /** The ID of the player responsible for the kill (if applicable) */
  AttackingPlayerID: z.number(),
});