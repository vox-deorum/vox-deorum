/**
 * @module knowledge/schema/events/lifecycle/PlayerDoTurn
 * @description PlayerDoTurn event schema
 */

import { z } from 'zod';

/**
 * Schema for the PlayerDoTurn event
 *
 * Triggered during the post-diplomacy phase of a player's turn processing.
 * This event fires after diplomatic actions are resolved but before end-of-turn
 * processing begins. It represents the main turn execution phase.
 *
 * @example
 * ```typescript
 * import { PlayerDoTurn } from './knowledge/schema/events/lifecycle/PlayerDoTurn.js';
 *
 * // Validate event data
 * const eventData = PlayerDoTurn.parse({ PlayerID: 0 });
 * ```
 */
export const PlayerDoTurn = z.object({
  /** The ID of the player whose turn is being processed */
  PlayerID: z.number(),
});