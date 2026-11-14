import { z } from "zod";

/**
 * TeamMeet event - triggered when two teams meet for the first time
 */
export const TeamMeet = z.object({
  /** The team being met by the current team */
  OtherTeamID: z.number(),
  /** The team initiating the meeting */
  CurrentTeamID: z.number(),
});