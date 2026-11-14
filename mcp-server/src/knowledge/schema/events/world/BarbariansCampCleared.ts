import { z } from 'zod';

/**
 * Schema for the BarbariansCampCleared event.
 * Triggered when a barbarian camp is successfully cleared by a player unit.
 */
export const BarbariansCampCleared = z.object({
  /** The X coordinate of the plot where the barbarian camp was located */
  PlotX: z.number(),
  /** The Y coordinate of the plot where the barbarian camp was located */
  PlotY: z.number(),
  /** The player ID of the player who cleared the barbarian camp */
  PlayerID: z.number(),
});