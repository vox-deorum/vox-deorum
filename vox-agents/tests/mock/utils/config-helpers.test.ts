/**
 * Unit tests for ProductionMode helper functions.
 * These are pure functions with no external dependencies.
 */

import { describe, it, expect } from 'vitest';
import { isVisualMode, isObsMode, isHumanControl } from '../../../src/types/config.js';
import type { StrategistSessionConfig } from '../../../src/types/config.js';

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
  it('should return true for test mode', () => {
    expect(isVisualMode('test')).toBe(true);
  });

  it('should return true for livestream mode', () => {
    expect(isVisualMode('livestream')).toBe(true);
  });

  it('should return true for recording mode', () => {
    expect(isVisualMode('recording')).toBe(true);
  });

  it('should return false for none mode', () => {
    expect(isVisualMode('none')).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isVisualMode(undefined)).toBe(false);
  });

  it('should return false when called without arguments', () => {
    expect(isVisualMode()).toBe(false);
  });
});

describe('isObsMode', () => {
  it('should return true for livestream mode', () => {
    expect(isObsMode('livestream')).toBe(true);
  });

  it('should return true for recording mode', () => {
    expect(isObsMode('recording')).toBe(true);
  });

  it('should return false for test mode', () => {
    expect(isObsMode('test')).toBe(false);
  });

  it('should return false for none mode', () => {
    expect(isObsMode('none')).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isObsMode(undefined)).toBe(false);
  });

  it('should return false when called without arguments', () => {
    expect(isObsMode()).toBe(false);
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
