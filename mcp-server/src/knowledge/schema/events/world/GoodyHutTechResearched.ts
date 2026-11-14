import { z } from 'zod';

/**
 * Schema for the GoodyHutTechResearched event
 * Triggered when a player discovers a technology through a goody hut exploration
 */
export const GoodyHutTechResearched = z.object({
  /** The ID of the player who received the technology */
  PlayerID: z.number(),
  /** The type/ID of the technology that was discovered */
  TechID: z.number()
});