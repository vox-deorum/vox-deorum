import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Each test file runs in the same fork (singleFork: true), so we use a unique
// temp dir per test and a unique configName per test to keep them isolated.
const tmpRoot = path.join(os.tmpdir(), 'vox-seating-state-tests');

vi.mock('../../src/utils/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/config.js')>();
  return {
    ...actual,
    getConfigsDir: () => tmpRoot
  };
});

// Imports come AFTER vi.mock so the mocked module is used by SeatingStateManager.
import { SeatingStateManager } from '../../src/utils/game/seating/state.js';
import type { SeatingClaim, SeatingState } from '../../src/utils/game/seating/types.js';

let testCounter = 0;
/** Produce a per-test unique config name so parallel state files never collide. */
function uniqueConfigName(label: string): string {
  testCounter++;
  return `${label}-${process.pid}-${testCounter}`;
}

/** Read and parse the on-disk state file for assertions about persistence. */
function readState(configName: string): SeatingState {
  const raw = fs.readFileSync(path.join(tmpRoot, `${configName}.seating.json`), 'utf8');
  return JSON.parse(raw) as SeatingState;
}

beforeEach(() => {
  fs.mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  // Clean up any state files between tests; keep tmpRoot itself.
  for (const file of fs.readdirSync(tmpRoot)) {
    fs.unlinkSync(path.join(tmpRoot, file));
  }
});

describe('SeatingStateManager — single seed', () => {
  it('creates a fresh state file on first claim and yields a valid map', async () => {
    const cfg = uniqueConfigName('fresh');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [7],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true
    });

    const claim = await mgr.claimNextCell();
    expect(claim.seedIndex).toBe(0);
    expect(claim.rotation).toBeGreaterThanOrEqual(0);
    expect(claim.rotation).toBeLessThan(8);
    expect(claim.seatingMap['7']).toBeGreaterThanOrEqual(0);
    expect(claim.seatingMap['7']).toBeLessThan(8);

    const state = readState(cfg);
    expect(state.totalSeats).toBe(8);
    expect(state.seedCount).toBe(1);
    expect(state.basePerm.length).toBe(8);
    expect(new Set(state.basePerm)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(state.consumeOrder.length).toBe(8);
    expect(state.consumeOrder[0]).toHaveProperty('rotation');
    expect(state.consumeOrder[0]).toHaveProperty('seedIndex');
    expect(Object.prototype.hasOwnProperty.call(state.consumeOrder[0], 'r')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(state.consumeOrder[0], 's')).toBe(false);
  });

  it('covers all 8 seats exactly once across one full cycle', async () => {
    const cfg = uniqueConfigName('cycle');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [7],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true
    });

    const seatsHit: number[] = [];
    for (let i = 0; i < 8; i++) {
      const claim = await mgr.claimNextCell();
      seatsHit.push(claim.seatingMap['7']);
      await mgr.releaseCell(claim, true);
    }

    expect(new Set(seatsHit)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
    const state = readState(cfg);
    // After 8 successful releases the cycle has not yet been reset (reset
    // happens on the next claim when allCompleted is detected).
    expect(state.completedCycles).toBe(0);
  });

  it('regenerates basePerm and increments completedCycles after one full cycle', async () => {
    const cfg = uniqueConfigName('rollover');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [7],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true
    });

    for (let i = 0; i < 8; i++) {
      const c = await mgr.claimNextCell();
      await mgr.releaseCell(c, true);
    }
    const before = readState(cfg);
    expect(before.completedCycles).toBe(0);

    const ninth = await mgr.claimNextCell();
    const after = readState(cfg);
    expect(after.completedCycles).toBe(1);
    // Ninth claim is the first of the new cycle (cells reset).
    expect(after.cells[String(ninth.rotation)][String(ninth.seedIndex)].status).toBe('in-progress');
  });

  it('returns the same cell after release-fail (cell goes back to pending)', async () => {
    const cfg = uniqueConfigName('release-fail');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [7],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true
    });

    const first = await mgr.claimNextCell();
    await mgr.releaseCell(first, false);

    const second = await mgr.claimNextCell();
    // The same cell is reclaimable since it went back to pending.
    expect(second.rotation).toBe(first.rotation);
    expect(second.seedIndex).toBe(first.seedIndex);
    expect(second.seatingMap).toEqual(first.seatingMap);
  });

  it('reclaims own in-progress cell on simulated restart', async () => {
    const cfg = uniqueConfigName('own-reclaim');
    const mgr1 = new SeatingStateManager({
      configName: cfg,
      configSlots: [7],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true
    });
    const first = await mgr1.claimNextCell();

    // Simulate a restart by constructing a fresh manager with the same configName
    // (same hostname#pid because we're in one process).
    const mgr2 = new SeatingStateManager({
      configName: cfg,
      configSlots: [7],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true
    });
    const reclaimed = await mgr2.claimNextCell();
    expect(reclaimed.rotation).toBe(first.rotation);
    expect(reclaimed.seedIndex).toBe(first.seedIndex);
  });
});

describe('SeatingStateManager — multi-seed', () => {
  it('covers every (seat, seedIndex) pair once across N×M cycle', async () => {
    const cfg = uniqueConfigName('multiseed');
    const seedSets = [{ sync: 1, map: 1 }, { sync: 2, map: 2 }, { sync: 3, map: 3 }];
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [7],
      totalSeats: 8,
      seedCount: 3,
      seedSets
    });

    const pairs = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const claim = await mgr.claimNextCell();
      pairs.add(`${claim.seatingMap['7']}:${claim.seedIndex}`);
      // Each seedIndex should resolve to the matching seedSets entry.
      expect(claim.seeds).toEqual(seedSets[claim.seedIndex]);
      await mgr.releaseCell(claim, true);
    }
    expect(pairs.size).toBe(24);

    const next = await mgr.claimNextCell();
    expect(next).toBeDefined();
    const state = readState(cfg);
    expect(state.completedCycles).toBe(1);
  });

  it('K=2 produces 16 distinct (seat_a, seat_b, seedIndex) triples with no duplicate seats per game', async () => {
    const cfg = uniqueConfigName('k2');
    const seedSets = [{ sync: 1, map: 1 }, { sync: 2, map: 2 }];
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [3, 5],
      totalSeats: 8,
      seedCount: 2,
      seedSets
    });

    const triples = new Set<string>();
    for (let i = 0; i < 16; i++) {
      const claim = await mgr.claimNextCell();
      const a = claim.seatingMap['3'];
      const b = claim.seatingMap['5'];
      expect(a).not.toBe(b);
      triples.add(`${a}:${b}:${claim.seedIndex}`);
      await mgr.releaseCell(claim, true);
    }
    expect(triples.size).toBe(16);
  });
});

describe('SeatingStateManager — config drift', () => {
  it('regenerates state when totalSeats changes, preserving completedCycles', async () => {
    const cfg = uniqueConfigName('drift');

    const mgrA = new SeatingStateManager({
      configName: cfg,
      configSlots: [3],
      totalSeats: 4,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true
    });
    for (let i = 0; i < 4; i++) {
      const c = await mgrA.claimNextCell();
      await mgrA.releaseCell(c, true);
    }
    // Trigger cycle reset to bump completedCycles to 1.
    const fifth = await mgrA.claimNextCell();
    await mgrA.releaseCell(fifth, true);
    expect(readState(cfg).completedCycles).toBe(1);

    // Now reopen with a different totalSeats — should regenerate but keep completedCycles.
    const mgrB = new SeatingStateManager({
      configName: cfg,
      configSlots: [7],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true
    });
    const claim = await mgrB.claimNextCell();
    expect(claim.seatingMap['7']).toBeGreaterThanOrEqual(0);
    expect(claim.seatingMap['7']).toBeLessThan(8);
    const state = readState(cfg);
    expect(state.totalSeats).toBe(8);
    expect(state.completedCycles).toBe(1);
  });
});

describe('SeatingStateManager — file lock serializes claims', () => {
  it('parallel claim+release pairs (single runner) cover all cells exactly once', async () => {
    // The "own runner reclaim" feature means parallel claims from the SAME
    // process+pid intentionally return the same cell until released — that's
    // the crash-recovery path, not a parallelism path. Real cross-runner
    // concurrency uses distinct PIDs (impossible to simulate in a single test
    // process). We approximate it here by interleaving claim+release pairs
    // through Promise.all so the file lock is exercised, then check that the
    // resulting cycle covers all 8 cells exactly once.
    const cfg = uniqueConfigName('lock-serialization');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [7],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true
    });

    const seenCells = new Set<string>();
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        const claim = await mgr.claimNextCell();
        seenCells.add(`${claim.rotation}:${claim.seedIndex}`);
        await mgr.releaseCell(claim, true);
      })
    );

    expect(seenCells.size).toBe(8);
    expect(await mgr.isCycleComplete()).toBe(true);
  });
});

describe('SeatingStateManager — release safety', () => {
  it('skips release when claimedAt does not match (another runner overwrote)', async () => {
    const cfg = uniqueConfigName('drift-release');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [7],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true
    });

    const claim = await mgr.claimNextCell();
    // Forge a stale claim object — pretend our `claimedAt` is from before.
    const staleClaim: SeatingClaim = {
      ...claim,
      claimedAt: new Date(Date.parse(claim.claimedAt) - 1000).toISOString()
    };
    await mgr.releaseCell(staleClaim, true);

    // Cell should remain in-progress (not completed or pending).
    const state = readState(cfg);
    expect(state.cells[String(claim.rotation)][String(claim.seedIndex)].status).toBe('in-progress');
  });
});

describe('SeatingStateManager — constructor validation', () => {
  it('rejects totalSeats <= 0', () => {
    expect(() => new SeatingStateManager({
      configName: 'x',
      configSlots: [0],
      totalSeats: 0,
      seedCount: 1,
      seedSets: [undefined]
    })).toThrow(/totalSeats/);
  });

  it('rejects empty configSlots', () => {
    expect(() => new SeatingStateManager({
      configName: 'x',
      configSlots: [],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined]
    })).toThrow(/configSlots/);
  });

  it('rejects configSlot out of range', () => {
    expect(() => new SeatingStateManager({
      configName: 'x',
      configSlots: [8],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined]
    })).toThrow(/out of range/);
  });

  it('rejects mismatched seedSets length vs seedCount', () => {
    expect(() => new SeatingStateManager({
      configName: 'x',
      configSlots: [0],
      totalSeats: 8,
      seedCount: 2,
      seedSets: [undefined]
    })).toThrow(/seedSets\.length/);
  });
});

describe('SeatingStateManager — trivial mode (no randomization, single seed)', () => {
  it('returns an identity claim without touching disk', async () => {
    const cfg = uniqueConfigName('trivial-identity');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [0, 2, 5],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [{ sync: 42 }],
      randomizeSeating: false,
    });

    const claim = await mgr.claimNextCell();

    // configSlot N → seat N — no permutation.
    expect(claim.rotation).toBe(0);
    expect(claim.seedIndex).toBe(0);
    expect(claim.seatingMap).toEqual({ '0': 0, '2': 2, '5': 5 });
    expect(claim.seeds).toEqual({ sync: 42 });

    // No state file should have been written.
    expect(fs.existsSync(path.join(tmpRoot, `${cfg}.seating.json`))).toBe(false);
  });

  it('treats releaseCell and attachGameId as no-ops in trivial mode', async () => {
    const cfg = uniqueConfigName('trivial-noop');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [3],
      totalSeats: 4,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: false,
    });

    const claim = await mgr.claimNextCell();

    // Both methods should resolve without throwing and without creating a state file.
    await mgr.releaseCell(claim, true, true);
    await mgr.attachGameId(claim, 'game-abc');

    expect(fs.existsSync(path.join(tmpRoot, `${cfg}.seating.json`))).toBe(false);
  });

  it('isCycleFinished and isCycleComplete are false (loops never auto-exit in trivial mode)', async () => {
    const mgr = new SeatingStateManager({
      configName: uniqueConfigName('trivial-cycle-state'),
      configSlots: [0],
      totalSeats: 1,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: false,
    });

    expect(await mgr.isCycleFinished()).toBe(false);
    expect(await mgr.isCycleComplete()).toBe(false);
  });

  it('still uses persistent state when randomizeSeating is true even with seedCount=1', async () => {
    const cfg = uniqueConfigName('trivial-disabled-by-randomize');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [0],
      totalSeats: 4,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true,
    });

    await mgr.claimNextCell();
    expect(fs.existsSync(path.join(tmpRoot, `${cfg}.seating.json`))).toBe(true);
  });

  it('still uses persistent state when seedCount > 1 even without randomizeSeating', async () => {
    const cfg = uniqueConfigName('trivial-disabled-by-seedcount');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [0],
      totalSeats: 4,
      seedCount: 2,
      seedSets: [undefined, { sync: 1 }],
      randomizeSeating: false,
    });

    await mgr.claimNextCell();
    expect(fs.existsSync(path.join(tmpRoot, `${cfg}.seating.json`))).toBe(true);
  });
});

describe('SeatingStateManager — seeded randomizeSeating', () => {
  /** Run a full N-cycle and return the sequence of (rotation, seedIndex, seat) tuples in order. */
  async function runFullCycle(mgr: SeatingStateManager, totalSeats: number, configSlot: number) {
    const sequence: Array<{ rotation: number; seedIndex: number; seat: number }> = [];
    for (let i = 0; i < totalSeats; i++) {
      const claim = await mgr.claimNextCell();
      sequence.push({
        rotation: claim.rotation,
        seedIndex: claim.seedIndex,
        seat: claim.seatingMap[String(configSlot)]
      });
      await mgr.releaseCell(claim, true);
    }
    return sequence;
  }

  it('two managers with the same seed produce the same basePerm and claim sequence', async () => {
    const cfgA = uniqueConfigName('seeded-determinism-a');
    const cfgB = uniqueConfigName('seeded-determinism-b');
    const optsBase = {
      configSlots: [7],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: 12345
    };

    const mgrA = new SeatingStateManager({ configName: cfgA, ...optsBase });
    const mgrB = new SeatingStateManager({ configName: cfgB, ...optsBase });

    const seqA = await runFullCycle(mgrA, 8, 7);
    const seqB = await runFullCycle(mgrB, 8, 7);

    expect(seqA).toEqual(seqB);

    // basePerm itself should also be byte-identical between the two state files.
    const stateA = readState(cfgA);
    const stateB = readState(cfgB);
    expect(stateA.basePerm).toEqual(stateB.basePerm);
    expect(stateA.consumeOrder).toEqual(stateB.consumeOrder);
    expect(stateA.seatingSeed).toBe(12345);
  });

  it('different seeds produce at least one different claim', async () => {
    const cfgA = uniqueConfigName('seeded-different-a');
    const cfgB = uniqueConfigName('seeded-different-b');

    const mgrA = new SeatingStateManager({
      configName: cfgA, configSlots: [7], totalSeats: 8,
      seedCount: 1, seedSets: [undefined], randomizeSeating: 1
    });
    const mgrB = new SeatingStateManager({
      configName: cfgB, configSlots: [7], totalSeats: 8,
      seedCount: 1, seedSets: [undefined], randomizeSeating: 2
    });

    const seqA = await runFullCycle(mgrA, 8, 7);
    const seqB = await runFullCycle(mgrB, 8, 7);

    // Each sequence still covers all 8 seats exactly once.
    expect(new Set(seqA.map(s => s.seat))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(new Set(seqB.map(s => s.seat))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
    // But the order differs.
    expect(seqA).not.toEqual(seqB);
  });

  it('changing the seed regenerates state while preserving completedCycles', async () => {
    const cfg = uniqueConfigName('seeded-drift');

    const mgrA = new SeatingStateManager({
      configName: cfg, configSlots: [7], totalSeats: 8,
      seedCount: 1, seedSets: [undefined], randomizeSeating: 100
    });
    for (let i = 0; i < 8; i++) {
      const c = await mgrA.claimNextCell();
      await mgrA.releaseCell(c, true);
    }
    // Trigger reset → completedCycles bumps to 1.
    const ninth = await mgrA.claimNextCell();
    await mgrA.releaseCell(ninth, true);
    const before = readState(cfg);
    expect(before.completedCycles).toBe(1);
    expect(before.seatingSeed).toBe(100);
    const basePermBefore = [...before.basePerm];

    // Reopen with a different seed — state must regenerate, completedCycles preserved.
    const mgrB = new SeatingStateManager({
      configName: cfg, configSlots: [7], totalSeats: 8,
      seedCount: 1, seedSets: [undefined], randomizeSeating: 999
    });
    await mgrB.claimNextCell();
    const after = readState(cfg);
    expect(after.seatingSeed).toBe(999);
    expect(after.completedCycles).toBe(1);
    expect(after.basePerm).not.toEqual(basePermBefore);
  });

  it('treats `randomizeSeating: true` as seed 0 and regenerates when transitioning from a numeric seed', async () => {
    const cfg = uniqueConfigName('true-aliases-zero');

    const mgrSeeded = new SeatingStateManager({
      configName: cfg, configSlots: [7], totalSeats: 8,
      seedCount: 1, seedSets: [undefined], randomizeSeating: 42
    });
    await mgrSeeded.claimNextCell();
    expect(readState(cfg).seatingSeed).toBe(42);

    // `true` is an alias for seed 0 → drift detected against persisted 42.
    const mgrTrue = new SeatingStateManager({
      configName: cfg, configSlots: [7], totalSeats: 8,
      seedCount: 1, seedSets: [undefined], randomizeSeating: true
    });
    await mgrTrue.claimNextCell();
    expect(readState(cfg).seatingSeed).toBe(0);
  });

  it('cycle rollover advances the seed: cycle #2 basePerm differs from cycle #1 but stays reproducible', async () => {
    const cfgA = uniqueConfigName('seed-advance-a');
    const cfgB = uniqueConfigName('seed-advance-b');
    const opts = {
      configSlots: [7], totalSeats: 8,
      seedCount: 1, seedSets: [undefined],
      randomizeSeating: 777
    };

    const mgrA = new SeatingStateManager({ configName: cfgA, ...opts });
    // Run a full cycle + one extra claim to trigger the reset.
    for (let i = 0; i < 8; i++) {
      const c = await mgrA.claimNextCell();
      await mgrA.releaseCell(c, true);
    }
    const cycle1BasePerm = [...readState(cfgA).basePerm];
    await mgrA.claimNextCell(); // forces resetCycleInPlace
    const cycle2BasePerm = [...readState(cfgA).basePerm];
    expect(readState(cfgA).completedCycles).toBe(1);
    expect(cycle2BasePerm).not.toEqual(cycle1BasePerm);

    // A second manager run from scratch with the same seed should reproduce
    // the same cycle #2 basePerm once it crosses the reset boundary.
    const mgrB = new SeatingStateManager({ configName: cfgB, ...opts });
    for (let i = 0; i < 8; i++) {
      const c = await mgrB.claimNextCell();
      await mgrB.releaseCell(c, true);
    }
    await mgrB.claimNextCell();
    expect(readState(cfgB).basePerm).toEqual(cycle2BasePerm);
  });

  it('accepts randomizeSeating: 0 as an explicit seed', () => {
    const mgr = new SeatingStateManager({
      configName: uniqueConfigName('seed-zero'),
      configSlots: [0],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: 0
    });
    // randomizeSeating: 0 is truthy-as-seed → cycle engaged, NOT trivial.
    return expect(mgr.claimNextCell()).resolves.toBeDefined();
  });

  it('rejects non-integer randomizeSeating', () => {
    expect(() => new SeatingStateManager({
      configName: 'x',
      configSlots: [0],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: 1.5
    })).toThrow(/randomizeSeating/);
  });
});
