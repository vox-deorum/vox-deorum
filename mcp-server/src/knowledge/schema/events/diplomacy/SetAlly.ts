import { z } from 'zod';

/**
 * SetAlly event - Triggered when a city-state's ally relationship changes
 */
export const SetAlly = z.object({
  /** The city-state whose ally relationship changed */
  MinorPlayerID: z.number(),
  /** The previous ally (NO_PLAYER if none) */
  OldAllyPlayerID: z.number(),
  /** The current ally (NO_PLAYER if none) */
  NewAllyPlayerID: z.number(),
});