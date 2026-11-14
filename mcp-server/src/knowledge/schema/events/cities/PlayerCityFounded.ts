/**
 * @module knowledge/schema/events/cities/PlayerCityFounded
 * @description PlayerCityFounded event schema
 */

import { z } from 'zod';

/**
 * Schema for PlayerCityFounded event data
 *
 * Fired when a player successfully establishes a new city. City founding is a
 * critical strategic action in Civilization V, expanding a civilization's territory,
 * resource access, and production capacity. This event provides the location and
 * owner of the newly founded city.
 *
 * @example
 * ```typescript
 * import { PlayerCityFounded } from './knowledge/schema/events/cities/PlayerCityFounded.js';
 *
 * // Validate event data
 * const eventData = PlayerCityFounded.parse({
 *   PlayerID: 0,
 *   PlotX: 25,
 *   PlotY: 30
 * });
 * ```
 */
export const PlayerCityFounded = z.object({
  /** The ID of the player who founded the city */
  PlayerID: z.number(),
  /** The X coordinate of the city's location */
  PlotX: z.number(),
  /** The Y coordinate of the city's location */
  PlotY: z.number()
});