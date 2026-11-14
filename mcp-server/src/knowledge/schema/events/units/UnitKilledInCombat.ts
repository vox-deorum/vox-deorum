import { z } from 'zod';

/**
 * Event triggered when a unit is killed during combat operations
 */
export const UnitKilledInCombat = z.object({
  /** The ID of the player who owns the unit that made the kill */
  KillerPlayerID: z.number(),
  /** The ID of the player who owned the unit that was killed */
  KilledPlayerID: z.number(),
  /** The type identifier of the unit that was killed */
  KilledUnitType: z.number(),
  /** The ID of the unit that made the kill (-1 if no specific killing unit) */
  KillingUnitID: z.number(),
});