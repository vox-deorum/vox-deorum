import { z } from 'zod';

/**
 * Event triggered when a team's technology ownership status changes
 */
export const TeamSetHasTech = z.object({
  /** The team whose technology status changed */
  TeamID: z.number(),
  
  /** The technology type identifier that was gained or lost */
  TechID: z.number(),
  
  /** Boolean indicating whether the team now has the technology (true = gained, false = lost) */
  HasTech: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false)
});