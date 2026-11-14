import { z } from 'zod';

/**
 * Schema for the DeclareWar event.
 * Triggered when one team formally declares war on another team in Civilization V.
 */
export const DeclareWar = z.object({
  /** The player who initiated the war declaration */
  OriginatingPlayerID: z.number(),
  /** The target team that war is being declared against */
  TargetTeamID: z.number(),
  /** Whether the declaring team is considered the aggressor */
  IsAggressor: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false)
});