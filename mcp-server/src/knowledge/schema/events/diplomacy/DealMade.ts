import { z } from 'zod';

/**
 * Schema for the DealMade event.
 * Triggered when a diplomatic deal is successfully concluded between two players.
 */
export const DealMade = z.object({
  /** The player ID of the player initiating the deal */
  FromPlayerID: z.number(),
  /** The player ID of the player receiving the deal */
  ToPlayerID: z.number(),
  /** The game turn when the deal starts */
  StartTurn: z.number(),
  /** The type of peace treaty (if applicable, 0 if not a peace treaty) */
  PeaceTreatyType: z.number(),
  /** Array of items being traded in the deal */
  TradedItems: z.array(z.object({
    /** The player ID of the player providing this item */
    FromPlayerID: z.number(),
    /** The type of item being traded (e.g., gold, resource, city) */
    ItemType: z.number(),
    /** Primary data value for the item (meaning depends on ItemType) */
    Data1: z.number(),
    /** Secondary data value for the item (meaning depends on ItemType) */
    Data2: z.number(),
    /** Tertiary data value for the item (meaning depends on ItemType) */
    Data3: z.number(),
    /** Duration of the trade item in turns (0 for permanent) */
    Duration: z.number(),
  })),
});