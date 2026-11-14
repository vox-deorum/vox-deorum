import { z } from 'zod';

/**
 * Schema for the ParadropAt event
 * Triggered when a military unit successfully executes a paradrop operation
 */
export const ParadropAt = z.object({
  /** The ID of the player who owns the unit performing the paradrop */
  PlayerID: z.number(),
  /** The unique identifier of the unit that performed the paradrop */
  UnitID: z.number(),
  /** The X coordinate of the tile where the unit started the paradrop */
  FromX: z.number(),
  /** The Y coordinate of the tile where the unit started the paradrop */
  FromY: z.number(),
  /** The X coordinate of the destination tile where the unit landed */
  ToX: z.number(),
  /** The Y coordinate of the destination tile where the unit landed */
  ToY: z.number(),
});