import { z } from 'zod';

/**
 * Schema for the GoodyHutReceivedBonus event
 * Triggered when a player's unit receives a bonus from exploring a goody hut
 */
export const GoodyHutReceivedBonus = z.object({
  /** The ID of the player who received the goody hut bonus */
  PlayerID: z.number(),
  /** The ID of the unit that explored the goody hut (-1 if no unit) */
  UnitID: z.number(),
  /** The type/ID of the bonus received from the goody hut */
  GoodyType: z.number(),
  /** The X coordinate of the plot where the goody hut was located */
  PlotX: z.number(),
  /** The Y coordinate of the plot where the goody hut was located */
  PlotY: z.number(),
});