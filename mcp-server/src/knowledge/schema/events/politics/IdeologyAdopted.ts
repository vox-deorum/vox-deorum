import { z } from 'zod';

/**
 * Schema for the IdeologyAdopted event
 * Triggered whenever a policy branch is unlocked or locked, despite the name. Vox Deorum drops the
 * locked case and stores the rest as PlayerAdoptPolicyBranch.
 */
export const IdeologyAdopted = z.object({
  /** The unique identifier of the player adopting the ideology */
  PlayerID: z.number(),
  /** The policy branch type identifier representing which ideology was adopted */
  BranchType: z.number()
});