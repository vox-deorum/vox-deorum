import { describe, it, expect } from 'vitest';
import { seededIndex } from '../../../src/utils/random.js';

describe('seededIndex', () => {
  it('is deterministic: same key yields the same index', () => {
    const key = '12345:0:7:tech';
    const first = seededIndex(key, 100);
    for (let i = 0; i < 10; i++) {
      expect(seededIndex(key, 100)).toBe(first);
    }
  });

  it('always returns an index within [0, length)', () => {
    for (let turn = 0; turn < 200; turn++) {
      const idx = seededIndex(`999:3:${turn}:policy`, 17);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(17);
    }
  });

  it('decorrelates across the choice discriminator', () => {
    // Over a representative sample of seeds, tech vs policy keys should differ
    // for the overwhelming majority (they share everything but the suffix).
    let differing = 0;
    const samples = 100;
    for (let seed = 1; seed <= samples; seed++) {
      const tech = seededIndex(`${seed}:0:5:tech`, 50);
      const policy = seededIndex(`${seed}:0:5:policy`, 50);
      if (tech !== policy) differing++;
    }
    expect(differing).toBeGreaterThan(samples * 0.8);
  });

  it('returns 0 for a non-positive length', () => {
    expect(seededIndex('any-key', 0)).toBe(0);
    expect(seededIndex('any-key', -3)).toBe(0);
  });
});
