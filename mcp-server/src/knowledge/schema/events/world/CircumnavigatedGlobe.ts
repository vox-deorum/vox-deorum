import { z } from 'zod';

/**
 * Schema for the CircumnavigatedGlobe event
 * Triggered when a team successfully circumnavigates the globe
 */
export const CircumnavigatedGlobe = z.object({
  /** The ID of the team that successfully circumnavigated the globe */
  TeamID: z.number(),
});