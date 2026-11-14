import { z } from 'zod';

/**
 * Schema for the MinorFriendsChanged event.
 * Triggered when a city-state's friendship relationship with a major civilization changes.
 */
export const MinorFriendsChanged = z.object({
  /** The city-state whose friendship relationship changed */
  MinorPlayerID: z.number(),
  
  /** The major civilization involved in the friendship change */
  MajorPlayerID: z.number(),
  
  /** Whether the major civ is now a friend */
  IsNowFriend: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
  
  /** The previous friendship level (before change) */
  OldFriendship: z.number(),
  
  /** The current friendship level (after change) */
  NewFriendship: z.number(),
});