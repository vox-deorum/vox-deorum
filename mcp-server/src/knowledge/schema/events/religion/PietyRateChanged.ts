import { z } from 'zod';

/**
 * Schema for the PietyRateChanged event.
 * Triggered when a player's Piety generation rate is modified.
 */
export const PietyRateChanged = z.object({
  /** The unique identifier of the player whose Piety rate has changed */
  PlayerID: z.number(),
  /** The current Piety generation rate per turn before the change */
  CurrentPietyRate: z.number(),
  /** The amount being set (for SetPietyRate) or the delta amount being applied (for ChangePietyRate) */
  ChangeValue: z.number()
});