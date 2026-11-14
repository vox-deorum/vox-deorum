import { z } from 'zod';

/**
 * Schema for the MinorGift event
 * Triggered when a city-state gives a first contact gift to a major civilization
 */
export const MinorGift = z.object({
  /** The city-state providing the gift */
  MinorPlayerID: z.number(),
  
  /** The major civilization receiving the gift */
  MajorPlayerID: z.number(),
  
  /** The primary gift value (varies by city-state type) */
  GiftValue: z.number(),
  
  /** The friendship/influence bonus received */
  FriendshipBoost: z.number(),
  
  /** Currently unused parameter (always 0) */
  Reserved1: z.number(),
  
  /** Whether this is the first major civ to meet this city-state */
  IsFirstDiscovery: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
  
  /** Currently unused boolean parameter (always false) */
  Reserved2: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
  
  /** String identifier for the gift type/notification text */
  GiftType: z.string(),
});