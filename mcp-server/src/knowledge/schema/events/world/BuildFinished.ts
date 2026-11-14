import { z } from 'zod';

/**
 * Schema for the BuildFinished event
 * Triggered when a unit completes any build action on a plot
 */
export const BuildFinished = z.object({
  /** The player ID who completed the build action */
  PlayerID: z.number(),
  /** The X coordinate of the plot where the build was completed */
  PlotX: z.number(),
  /** The Y coordinate of the plot where the build was completed */
  PlotY: z.number(),
  /** The improvement type defined in the build info (NO_IMPROVEMENT for non-improvement builds) */
  ImprovementType: z.number()
});