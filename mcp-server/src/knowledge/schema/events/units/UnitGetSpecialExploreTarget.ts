import { z } from 'zod';

/**
 * Triggered when the AI system queries for special exploration targets for a unit
 */
export const UnitGetSpecialExploreTarget = z.object({
  /** The ID of the player who owns the unit seeking exploration targets */
  PlayerID: z.number(),
  /** The unique identifier of the unit that needs an exploration target */
  UnitID: z.number(),
});