/**
 * @module knowledge/schema/events/units/UnitCreated
 * @description UnitCreated event schema
 */

import { z } from 'zod';

/**
 * Schema for the UnitCreated event triggered when a new unit is successfully created in the game
 *
 * This event is fired whenever a unit is created through any means: city production,
 * purchasing, upgrading, or spawning. It provides the essential information about
 * the new unit including its owner, type, and initial location.
 *
 * @example
 * ```typescript
 * import { UnitCreated } from './knowledge/schema/events/units/UnitCreated.js';
 *
 * // Validate event data
 * const eventData = UnitCreated.parse({
 *   PlayerID: 0,
 *   UnitID: 1234,
 *   UnitType: 42,
 *   PlotX: 50,
 *   PlotY: 75
 * });
 * ```
 */
export const UnitCreated = z.object({
  /** The ID of the player who owns the newly created unit */
  PlayerID: z.number(),
  /** The unique identifier assigned to the new unit */
  UnitID: z.number(),
  /** The type identifier of the unit that was created */
  UnitType: z.number(),
  /** The X coordinate where the unit was created */
  PlotX: z.number(),
  /** The Y coordinate where the unit was created */
  PlotY: z.number(),
});