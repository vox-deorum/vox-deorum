import { z } from "zod";

/**
 * Schema for the PlayerProtected event
 * Triggered when a major civilization pledges to protect a minor civilization (city-state)
 */
export const PlayerProtected = z.object({
  /** The player ID of the major civilization pledging protection */
  MajorPlayerID: z.number(),
  /** The player ID of the minor civilization being protected */
  MinorPlayerID: z.number()
});