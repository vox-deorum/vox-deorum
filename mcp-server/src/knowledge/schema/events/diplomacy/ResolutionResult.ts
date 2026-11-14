import { z } from 'zod';

/**
 * Triggered when a World Congress or League resolution voting concludes
 */
export const ResolutionResult = z.object({
  /** The type identifier of the resolution being voted on */
  ResolutionType: z.number(),
  /** The player who proposed the resolution */
  ProposerPlayerID: z.number(),
  /** The specific choice or target of the resolution */
  Decision: z.number(),
  /** True for enact proposals, false for repeal proposals */
  IsEnact: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
  /** Whether the resolution passed or failed */
  Passed: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
});