import { z } from 'zod';

/**
 * Schema for the PlayerRevoked event.
 * Triggered when a major civilization revokes their pledge of protection from a minor civilization.
 */
export const PlayerRevoked = z.object({
  /** The player ID of the major civilization revoking protection */
  MajorPlayerID: z.number(),
  /** The player ID of the minor civilization losing protection */
  MinorPlayerID: z.number(),
  /** Whether this action breaks an existing protection pledge */
  PledgeNowBroken: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false)
});