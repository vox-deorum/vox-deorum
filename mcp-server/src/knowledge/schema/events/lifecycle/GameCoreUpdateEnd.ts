import { z } from 'zod';

/**
 * GameCoreUpdateEnd event schema
 * Triggered at the conclusion of each game update cycle
 * This event takes no parameters
 */
export const GameCoreUpdateEnd = z.object({});