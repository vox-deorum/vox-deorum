import { z } from 'zod';

/**
 * Schema for GameCoreTestVictory event.
 * Triggered during the game's victory condition testing phase.
 * This event takes no parameters and provides a general hook for victory testing.
 */
export const GameCoreTestVictory = z.object({});