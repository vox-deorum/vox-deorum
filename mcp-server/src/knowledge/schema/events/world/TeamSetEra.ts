import { z } from 'zod';

/**
 * Schema for TeamSetEra event - fired when a team advances to a new era
 */
export const TeamSetEra = z.object({
  /** The team advancing to the new era */
  TeamID: z.number(),
  /** The era type that the team has advanced to */
  NewEra: z.number(),
});