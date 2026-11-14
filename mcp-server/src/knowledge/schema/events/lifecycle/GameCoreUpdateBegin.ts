import { z } from 'zod';

/**
 * Schema for GameCoreUpdateBegin event
 * Triggered at the start of each game update cycle
 * This event takes no parameters
 */
export const GameCoreUpdateBegin = z.object({});