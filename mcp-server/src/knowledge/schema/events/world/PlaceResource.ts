import { z } from 'zod';

/**
 * Schema for the PlaceResource event - triggered when a resource is placed on the map,
 * typically as part of a civilization's unique luxury resource system
 */
export const PlaceResource = z.object({
  /** The ID of the player receiving the placed resource */
  PlayerID: z.number(),
  /** The type/ID of the resource being placed */
  ResourceType: z.number(),
  /** The quantity of the resource being placed */
  Quantity: z.number(),
  /** The X coordinate where the resource is being placed */
  CityX: z.number(),
  /** The Y coordinate where the resource is being placed */
  CityY: z.number()
});