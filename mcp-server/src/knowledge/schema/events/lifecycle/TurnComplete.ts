/**
 * @module knowledge/schema/events/lifecycle/TurnComplete
 * @description TurnComplete event schema
 */

import { z } from 'zod';

/**
 * TurnComplete event - Triggered at various points during turn completion processing
 *
 * This event fires when the game completes processing for all players in a turn.
 * It marks the transition between game turns and can be used to perform end-of-turn
 * calculations, cleanup, or state updates.
 *
 * @example
 * ```typescript
 * import { TurnComplete } from './knowledge/schema/events/lifecycle/TurnComplete.js';
 *
 * // Validate event data
 * const eventData = TurnComplete.parse({
 *   ActivePlayerID: 0
 * });
 * ```
 */
export const TurnComplete = z.object({
  /** The player who is currently the active player during turn completion */
  ActivePlayerID: z.number(),
});