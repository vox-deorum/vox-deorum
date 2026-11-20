import { describe, expect, it } from 'vitest';
import { sampleStoryTurns } from '../../../src/archivist/pipeline/story-sampler.js';

describe('story turn sampling', () => {
  const recordedTurns = Array.from({ length: 120 }, (_, turn) => turn);

  it('should sample six reproducible turns by default for the same game, player and seed', () => {
    const sample = sampleStoryTurns(recordedTurns, 'game-one', 2, '42');

    expect(sample).toHaveLength(6);
    expect(sampleStoryTurns(recordedTurns, 'game-one', 2, '42')).toEqual(sample);
  });

  it('should vary the sample with the seed, game and player', () => {
    const sample = sampleStoryTurns(recordedTurns, 'game-one', 2, '42');

    expect(sampleStoryTurns(recordedTurns, 'game-one', 2, '43')).not.toEqual(sample);
    expect(sampleStoryTurns(recordedTurns, 'game-two', 2, '42')).not.toEqual(sample);
    expect(sampleStoryTurns(recordedTurns, 'game-one', 3, '42')).not.toEqual(sample);
  });

  it('should pick one turn from each slice of the sorted distinct turns', () => {
    const turns = [80, 1, 20, 9, 40, 4, 9, 7, 100, 55];
    const sample = sampleStoryTurns(turns, 'game-one', 2, '44', 3);

    expect(sample).toHaveLength(3);
    expect([1, 4, 7]).toContain(sample[0]);
    expect([9, 20, 40]).toContain(sample[1]);
    expect([55, 80, 100]).toContain(sample[2]);
  });

  it('should return all distinct turns in order when there are fewer than requested', () => {
    expect(sampleStoryTurns([9, 1, 3, 9], 'game-one', 2, '42')).toEqual([1, 3, 9]);
  });

  it('should return an empty sample when there are no recorded turns', () => {
    expect(sampleStoryTurns([], 'game-one', 2, '42')).toEqual([]);
  });

  it.each([-1, 1.5, NaN])('should reject an invalid count of %s', (count) => {
    expect(() => sampleStoryTurns(recordedTurns, 'game-one', 2, '42', count)).toThrow(RangeError);
  });
});
