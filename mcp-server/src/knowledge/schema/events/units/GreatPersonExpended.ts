import { z } from 'zod';

/**
 * Schema for the GreatPersonExpended event.
 * Triggered when a Great Person unit is consumed or expended to provide a benefit to the player.
 */
export const GreatPersonExpended = z.object({
  /** The unique identifier of the player who owned the Great Person */
  PlayerID: z.number(),
  /** The unique identifier of the specific Great Person unit */
  UnitID: z.number(),
  /** The unit type of the expended Great Person (a Units ID, not a GreatPersons ID) */
  GreatPersonType: z.number(),
  /** The X map coordinate where the Great Person was expended */
  CityX: z.number(),
  /** The Y map coordinate where the Great Person was expended */
  CityY: z.number()
});