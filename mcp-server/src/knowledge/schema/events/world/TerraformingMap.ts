import { z } from 'zod';

/**
 * TerraformingMap event - triggered during map loading and initialization processes
 */
export const TerraformingMap = z.object({
  /** The type of terraforming event (TERRAFORMINGEVENT_LOAD) */
  EventType: z.number(),
  /** The initialization phase (0 for game-level, 1 for map-level) */
  Phase: z.number(),
});