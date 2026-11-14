import { z } from 'zod';

/**
 * Event fired when a player assigns a mission to a selected unit that targets a specific plot.
 * Occurs before the mission is actually executed, providing an opportunity to intercept or modify mission assignments.
 */
export const PushingMissionTo = z.object({
  /** The ID of the player who owns the unit receiving the mission */
  PlayerID: z.number(),
  /** The unique identifier of the selected unit being given the mission */
  UnitID: z.number(),
  /** The X coordinate of the plot that is the target of the mission */
  PlotX: z.number(),
  /** The Y coordinate of the plot that is the target of the mission */
  PlotY: z.number(),
  /** Additional mission-specific data */
  MissionData: z.number(),
});