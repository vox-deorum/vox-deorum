/**
 * Unit tests for ProductionMode helper functions.
 * These are pure functions with no external dependencies.
 */

import { describe, it, expect } from 'vitest';
import { isVisualMode, isObsMode, isHumanControl } from '../../../../src/types/config.js';
import type { StrategistSessionConfig } from '../../../../src/types/config.js';

/** Minimal strategist config builder for the human-control helper tests. */
function makeConfig(llmPlayers: StrategistSessionConfig['llmPlayers']): StrategistSessionConfig {
  return {
    name: 'test',
    type: 'strategist',
    autoPlay: true,
    gameMode: 'start',
    llmPlayers,
  };
}

describe('isVisualMode', () => {
  it.each([
    ['test mode', 'test', true],
    ['livestream mode', 'livestream', true],
    ['recording mode', 'recording', true],
    ['none mode', 'none', false],
    ['undefined', undefined, false],
  ] as Array<[string, Parameters<typeof isVisualMode>[0], boolean]>)('should return the expected result for %s', (_label, mode, expected) => {
    expect(isVisualMode(mode)).toBe(expected);
  });
});

describe('isObsMode', () => {
  it.each([
    ['livestream mode', 'livestream', true],
    ['recording mode', 'recording', true],
    ['test mode', 'test', false],
    ['none mode', 'none', false],
    ['undefined', undefined, false],
  ] as Array<[string, Parameters<typeof isObsMode>[0], boolean]>)('should return the expected result for %s', (_label, mode, expected) => {
    expect(isObsMode(mode)).toBe(expected);
  });
});

describe('isHumanControl', () => {
  it('should return true when a seat uses the human-strategist', () => {
    expect(isHumanControl(makeConfig({ 7: { strategist: 'human-strategist', mode: 'Flavor' } }))).toBe(true);
  });

  it('should return true when a human seat is mixed with other strategists', () => {
    expect(isHumanControl(makeConfig({
      0: { strategist: 'null-strategist' },
      7: { strategist: 'human-strategist' },
    }))).toBe(true);
  });

  it('should return false when no seat uses the human-strategist', () => {
    expect(isHumanControl(makeConfig({
      0: { strategist: 'null-strategist' },
      1: { strategist: 'simple-strategist' },
    }))).toBe(false);
  });

  it('should return false for an empty seating', () => {
    expect(isHumanControl(makeConfig({}))).toBe(false);
  });
});
