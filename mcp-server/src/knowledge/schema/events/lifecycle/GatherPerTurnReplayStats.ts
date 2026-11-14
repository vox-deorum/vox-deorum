import { z } from 'zod';

/**
 * Schema for the GatherPerTurnReplayStats event
 * Triggered during per-turn statistics gathering for replay functionality
 */
export const GatherPerTurnReplayStats = z.object({
  /** The ID of the player for whom statistics are being gathered */
  PlayerID: z.number(),
});