import { z } from 'zod';

/**
 * Schema for the PlayerEndOfMayaLongCount event.
 * Triggered when a Maya civilization completes a baktun cycle in the Maya Long Count calendar system.
 */
export const PlayerEndOfMayaLongCount = z.object({
  /** The ID of the Maya player */
  PlayerID: z.number(),
  
  /** The current baktun number */
  CurrentBaktun: z.number(),
  
  /** The previous baktun number */
  OldBaktun: z.number()
});