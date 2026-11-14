import { z } from 'zod';

/**
 * Schema for PlayerTradeRouteCompleted event
 * Triggered when a trade route successfully completes its journey and reaches its destination
 */
export const PlayerTradeRouteCompleted = z.object({
  /** The player ID who owns the origin city of the completed trade route */
  OriginPlayerID: z.number(),
  
  /** The unique identifier of the origin city where the trade route started */
  OriginCityID: z.number(),
  
  /** The player ID who owns the destination city of the completed trade route */
  DestinationPlayerID: z.number(),
  
  /** The unique identifier of the destination city where the trade route ended */
  DestinationCityID: z.number(),
  
  /** The domain of the completed trade route (land or sea) */
  Domain: z.number(),
  
  /** The type of trade connection that was completed */
  ConnectionType: z.number()
});