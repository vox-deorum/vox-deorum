import { z } from 'zod';

/**
 * Schema for the CityCreated event triggered when a city creates/produces a project
 */
export const CityCreated = z.object({
  /** The ID of the player who owns the city */
  OwnerID: z.number(),
  /** The unique identifier of the city */
  CityID: z.number(),
  /** The type of project that was created */
  ProjectType: z.number(),
  /** Whether the project was purchased with gold (true) or produced normally (false) */
  IsGoldPurchase: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
  /** Whether the project was purchased with faith/culture - always false for projects */
  IsFaithPurchase: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false)
});