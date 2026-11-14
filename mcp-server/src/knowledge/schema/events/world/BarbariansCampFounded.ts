/**
 * @module knowledge/schema/events/world/BarbariansCampFounded
 * @description BarbariansCampFounded event schema
 */

import { z } from 'zod';

/**
 * Schema for the BarbariansCampFounded event
 *
 * Triggered when a new barbarian camp is established on the game map.
 * Barbarian camps spawn periodically on unexplored or undefended tiles and
 * produce barbarian units that can threaten nearby civilizations.
 *
 * @example
 * ```typescript
 * import { BarbariansCampFounded } from './knowledge/schema/events/world/BarbariansCampFounded.js';
 *
 * // Validate event data
 * const eventData = BarbariansCampFounded.parse({
 *   PlotX: 45,
 *   PlotY: 60
 * });
 * ```
 */
export const BarbariansCampFounded = z.object({
  /** The X coordinate of the plot where the barbarian camp was founded */
  PlotX: z.number(),
  /** The Y coordinate of the plot where the barbarian camp was founded */
  PlotY: z.number()
});