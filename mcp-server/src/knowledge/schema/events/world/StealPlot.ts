import { z } from 'zod';

/** Event triggered when a plot is stolen from one player by another (via culture bomb or foreign tile purchase) */
export const StealPlot = z.object({
  /** The X coordinate of the stolen plot */
  PlotX: z.number(),
  /** The Y coordinate of the stolen plot */
  PlotY: z.number(),
  /** The player ID of the victim (original owner) */
  FromPlayerID: z.number(),
  /** The player ID of the thief (new owner) */
  ToPlayerID: z.number(),
});
