import { z } from 'zod';

/**
 * Schema for the MakePeace event triggered when two teams formally establish peace
 * and end their state of war in Civilization V
 */
export const MakePeace = z.object({
  /** The unique identifier of the player who initiated the peace */
  OriginatingPlayerID: z.number(),
  /** The unique identifier of the team that peace is being made with */
  TargetTeamID: z.number(),
  /** Boolean indicating if this is a "pacifier" peace (specific diplomatic context) */
  PacifierFlag: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false)
});