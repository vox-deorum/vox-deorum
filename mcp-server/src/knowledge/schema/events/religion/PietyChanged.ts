import { z } from 'zod';

/**
 * Schema for the PietyChanged event
 * Triggered when a player's Piety value is modified
 */
export const PietyChanged = z.object({
  /** The unique identifier of the player whose Piety has changed */
  PlayerID: z.number(),
  /** The current total Piety value before the change */
  CurrentPiety: z.number(),
  /** The amount being set (for SetPiety) or the delta amount being applied (for ChangePiety) */
  ChangeValue: z.number()
});