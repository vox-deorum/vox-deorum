/**
 * @module knowledge/schema/events/scripted/CityEventActivated
 * @description CityEventActivated event schema
 */

import { z } from 'zod';

/**
 * Schema for the CityEventActivated event
 *
 * Triggered when a city event begins in Civilization V. City events are
 * special occurrences that affect individual cities, providing choices
 * and consequences that impact city development.
 *
 * @example
 * ```typescript
 * import { CityEventActivated } from './knowledge/schema/events/scripted/CityEventActivated.js';
 *
 * // Validate event data
 * const eventData = CityEventActivated.parse({
 *   PlayerID: 0,
 *   CityID: 5,
 *   EventID: 12
 * });
 * ```
 */
export const CityEventActivated = z.object({
  /** The ID of the player who owns the city where the event is activated */
  PlayerID: z.number(),

  /** The unique identifier of the city where the event is activated */
  CityID: z.number(),

  /** The identifier of the specific city event type being activated */
  EventID: z.number()
});