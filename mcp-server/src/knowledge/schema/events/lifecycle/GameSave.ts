/**
 * @module knowledge/schema/events/lifecycle/GameSave
 * @description GameSave event schema
 */

import { z } from "zod";

/**
 * GameSave event - triggered when the game is being saved to disk
 *
 * This event takes no parameters and provides a general hook for save processing.
 * It can be used to perform cleanup, persist state, or log game save operations.
 *
 * @example
 * ```typescript
 * import { GameSave } from './knowledge/schema/events/lifecycle/GameSave.js';
 *
 * // Validate event data
 * const eventData = GameSave.parse({});
 * ```
 */
export const GameSave = z.object({});