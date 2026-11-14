import { z } from "zod";

/**
 * Event triggered when a major civilization successfully buys out a city-state (minor civilization)
 */
export const PlayerBoughtOut = z.object({
  /** The ID of the major civilization that performed the buyout */
  BuyingPlayerID: z.number(),
  /** The ID of the minor civilization (city-state) that was bought out */
  MinorPlayerID: z.number()
});