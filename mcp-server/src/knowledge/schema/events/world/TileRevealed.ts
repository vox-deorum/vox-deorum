import { z } from 'zod';

/**
 * Event triggered when a tile is revealed to a team for the first time through exploration, vision, or other game mechanics
 */
export const TileRevealed = z.object({
  /** The X coordinate of the tile being revealed */
  PlotX: z.number(),
  /** The Y coordinate of the tile being revealed */
  PlotY: z.number(),
  /** The team ID that is gaining vision of the tile */
  RevealedToTeamID: z.number(),
  /** The team ID responsible for the revelation (if applicable) */
  RevealedByTeamID: z.number(),
  /** Whether this is the first major civilization to discover this tile */
  IsFirstDiscovery: z.union([z.number(), z.boolean()]).transform((arg) => arg !== 0 && arg !== false),
  /** The player ID of the unit owner causing the revelation (NO_PLAYER if not unit-based) */
  PlayerID: z.number(),
  /** The ID of the specific unit revealing the tile (-1 if not unit-based) */
  UnitID: z.number(),
});