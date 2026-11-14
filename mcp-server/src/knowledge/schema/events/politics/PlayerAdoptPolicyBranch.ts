import { z } from 'zod';

/**
 * Event triggered when a player unlocks a policy branch, including a first ideology.
 * Vox Deorum stores the game's IdeologyAdopted event under this name; the DLL skips the game's own
 * PlayerAdoptPolicyBranch, which misses some adoption paths. Ideology switches are reported by IdeologySwitched.
 */
export const PlayerAdoptPolicyBranch = z.object({
  /** The ID of the player who adopted the policy branch */
  PlayerID: z.number(),
  /** The type of policy branch that was adopted */
  BranchType: z.number()
});