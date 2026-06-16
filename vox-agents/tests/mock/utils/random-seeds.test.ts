import { describe, expect, it } from 'vitest';
import {
  mergeRandomSeeds,
  parseSeedArgument,
  validateRandomSeeds
} from '../../../src/utils/game/random-seeds.js';

describe('random seed parsing', () => {
  it('parses both CLI seeds', () => {
    expect(parseSeedArgument('1:2')).toEqual({ sync: 1, map: 2 });
  });

  it('parses sync-only CLI seed', () => {
    expect(parseSeedArgument('1:')).toEqual({ sync: 1 });
  });

  it('parses map-only CLI seed', () => {
    expect(parseSeedArgument(':2')).toEqual({ map: 2 });
  });

  it('rejects invalid CLI seed forms and values', () => {
    for (const value of ['', ':', '1', '1:2:3', '0:1', '-1:2', '1.5:2', '4294967296:1']) {
      expect(() => parseSeedArgument(value)).toThrow();
    }
  });

  it('validates config seeds and drops an empty object', () => {
    expect(validateRandomSeeds({ sync: 10 })).toEqual({ sync: 10 });
    expect(validateRandomSeeds({ map: 20 })).toEqual({ map: 20 });
    expect(validateRandomSeeds({})).toBeUndefined();
    expect(() => validateRandomSeeds({ sync: 0 })).toThrow();
  });

  it('lets CLI overrides replace only the mentioned seed', () => {
    expect(mergeRandomSeeds({ sync: 1, map: 2 }, { sync: 3 })).toEqual({ sync: 3, map: 2 });
    expect(mergeRandomSeeds({ sync: 1, map: 2 }, { map: 4 })).toEqual({ sync: 1, map: 4 });
  });
});
