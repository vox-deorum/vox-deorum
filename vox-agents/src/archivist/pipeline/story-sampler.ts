import { seededIndex } from '../../utils/random.js';

export const defaultStoryTurnCount = 6;

/** Reject counts that cannot represent a number of sampled turns. */
export function validateStoryTurnCount(count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError('--story-turns must be a nonnegative integer');
  }
}

/** Pick one recorded turn per slice using stable seed keys for this game and player. */
export function sampleStoryTurns(
  turns: readonly number[],
  gameId: string,
  playerId: number,
  seed: string,
  count = defaultStoryTurnCount
): number[] {
  validateStoryTurnCount(count);

  const sorted = [...new Set(turns)].sort((a, b) => a - b);
  if (sorted.length <= count) return sorted;

  const samples: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * sorted.length / count);
    const end = Math.floor((i + 1) * sorted.length / count);
    const offset = seededIndex(JSON.stringify([seed, gameId, playerId, i]), end - start);
    samples.push(sorted[start + offset]);
  }
  return samples;
}
