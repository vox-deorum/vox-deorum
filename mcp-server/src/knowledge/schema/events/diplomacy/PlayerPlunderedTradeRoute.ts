import { z } from 'zod';

/**
 * Schema for the PlayerPlunderedTradeRoute event
 * Triggered when a unit successfully plunders (pillages) a trade route
 */
export const PlayerPlunderedTradeRoute = z.object({
  /** The player ID of the unit that performed the plundering */
  PlunderingPlayerID: z.number(),
  
  /** The unique identifier of the unit that plundered the trade route */
  PlunderingUnitID: z.number(),
  
  /** The amount of gold gained from plundering the trade route */
  PlunderGoldValue: z.number(),
  
  /** The player ID who owns the origin city of the plundered trade route */
  OriginOwnerID: z.number(),
  
  /** The unique identifier of the origin city */
  OriginCityID: z.number(),
  
  /** The player ID who owns the destination city of the plundered trade route */
  DestinationOwnerID: z.number(),
  
  /** The unique identifier of the destination city */
  DestinationCityID: z.number(),
  
  /** The type of trade connection that was plundered */
  ConnectionType: z.number(),
  
  /** The domain of the trade route (land or sea) */
  Domain: z.number()
});