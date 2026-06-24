import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Each test file runs in the same fork (singleFork: true), so we use a unique
// temp dir per test and a unique configName per test to keep them isolated.
const tmpRoot = path.join(os.tmpdir(), 'vox-seating-state-tests');

vi.mock('../../../src/utils/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/config.js')>();
  return {
    ...actual,
    getConfigsDir: () => tmpRoot
  };
});

// Imports come AFTER vi.mock so the mocked module is used by SeatingStateManager.
import { SeatingStateManager } from '../../../src/utils/game/seating/state.js';
import { buildSeatingMap, seatingMapsEqual } from '../../../src/utils/game/seating/cells.js';
import type { SeatingClaim, SeatingState } from '../../../src/utils/game/seating/types.js';

let testCounter = 0;
/** Produce a per-test unique config name so parallel state files never collide. */
function uniqueConfigName(label: string): string {
  testCounter++;
  return `${label}-${process.pid}-${testCounter}`;
}

/**
 * Unwrap `claimNextCell` for setups where a claim is always expected. Tests
 * that need to assert the `null` (finished) path call `claimNextCell` directly.
 */
async function mustClaim(m: SeatingStateManager): Promise<SeatingClaim> {
  const c = await m.claimNextCell();
  if (!c) throw new Error('expected a claim, got null (cycle finished)');
  return c;
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

    const claim = await mustClaim(mgr);
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
      const claim = await mustClaim(mgr);
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
      const c = await mustClaim(mgr);
      await mgr.releaseCell(c, true);
    }
    const before = readState(cfg);
    expect(before.completedCycles).toBe(0);

    const ninth = await mustClaim(mgr);
    const after = readState(cfg);
    expect(after.completedCycles).toBe(1);
    // Ninth claim is the first of the new cycle (cells reset).
    expect(after.cells[String(ninth.rotation)][String(ninth.seedIndex)].status).toBe('in-progress');
  });

  it('records completedBy on successful release and on archive-miss release', async () => {
    const cfg = uniqueConfigName('completed-by');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [7],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true,
    });

    const expectedRunner = `${os.hostname()}#${process.pid}`;

    // Success + archived: cell completed, completedBy recorded.
    const okClaim = await mustClaim(mgr);
    await mgr.releaseCell(okClaim, true, true);
    let state = readState(cfg);
    let okCell = state.cells[String(okClaim.rotation)][String(okClaim.seedIndex)];
    expect(okCell.status).toBe('completed');
    expect(okCell.completedBy).toBe(expectedRunner);

    // Victory observed but archive missing: cell goes back to pending, but
    // completedBy is still recorded for forensics.
    const missClaim = await mustClaim(mgr);
    await mgr.releaseCell(missClaim, true, false);
    state = readState(cfg);
    const missCell = state.cells[String(missClaim.rotation)][String(missClaim.seedIndex)];
    expect(missCell.status).toBe('pending');
    expect(missCell.completedBy).toBe(expectedRunner);

    // Non-victory failure on a fresh cell: completedBy is NOT recorded (nothing completed).
    // The missClaim cell is still the highest-priority pending one, so explicitly
    // release it as completed first to advance past it, then test a fresh cell.
    const drainClaim = await mustClaim(mgr);
    expect(drainClaim.rotation).toBe(missClaim.rotation);
    expect(drainClaim.seedIndex).toBe(missClaim.seedIndex);
    await mgr.releaseCell(drainClaim, true, true);

    const crashClaim = await mustClaim(mgr);
    await mgr.releaseCell(crashClaim, false);
    state = readState(cfg);
    const crashCell = state.cells[String(crashClaim.rotation)][String(crashClaim.seedIndex)];
    expect(crashCell.status).toBe('pending');
    expect(crashCell.completedBy).toBeUndefined();
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

    const first = await mustClaim(mgr);
    await mgr.releaseCell(first, false);

    const second = await mustClaim(mgr);
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
    const first = await mustClaim(mgr1);

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
    const reclaimed = await mustClaim(mgr2);
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
      const claim = await mustClaim(mgr);
      pairs.add(`${claim.seatingMap['7']}:${claim.seedIndex}`);
      // Each seedIndex should resolve to the matching seedSets entry.
      expect(claim.seeds).toEqual(seedSets[claim.seedIndex]);
      await mgr.releaseCell(claim, true);
    }
    expect(pairs.size).toBe(24);

    const next = await mustClaim(mgr);
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
      const claim = await mustClaim(mgr);
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
      const c = await mustClaim(mgrA);
      await mgrA.releaseCell(c, true);
    }
    // Trigger cycle reset to bump completedCycles to 1.
    const fifth = await mustClaim(mgrA);
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
    const claim = await mustClaim(mgrB);
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
        const claim = await mustClaim(mgr);
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

    const claim = await mustClaim(mgr);
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

describe('SeatingStateManager — pick priority (pending beats stale steal)', () => {
  /** Overwrite the state file in place. Used to forge foreign/stale claims. */
  function writeStateFile(configName: string, state: SeatingState): void {
    fs.writeFileSync(
      path.join(tmpRoot, `${configName}.seating.json`),
      JSON.stringify(state, null, 2)
    );
  }

  it('prefers a pending cell over stealing a stale foreign in-progress claim', async () => {
    const cfg = uniqueConfigName('prefer-pending');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [7],
      totalSeats: 8,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true,
    });

    // Make the manager write a valid state file with one cell in-progress,
    // then re-attribute that cell to a foreign runner with a stale claimedAt.
    const claimed = await mustClaim(mgr);
    const state = readState(cfg);
    const r = String(claimed.rotation);
    const s = String(claimed.seedIndex);
    state.cells[r][s] = {
      ...state.cells[r][s],
      claimedBy: 'foreign-host#9999',
      claimedAt: new Date(Date.now() - 80 * 60 * 60 * 1000).toISOString(), // 80h ago — stale
    };
    writeStateFile(cfg, state);

    // Next claim should pick a different pending cell, not steal the stale one.
    const next = await mustClaim(mgr);
    expect(`${next.rotation}:${next.seedIndex}`).not.toBe(`${claimed.rotation}:${claimed.seedIndex}`);

    // The stale foreign cell must be left alone — claimedBy unchanged, no failure bump.
    const after = readState(cfg);
    const foreign = after.cells[r][s];
    expect(foreign.status).toBe('in-progress');
    expect(foreign.claimedBy).toBe('foreign-host#9999');
    expect(foreign.failureCount ?? 0).toBe(0);
  });

  it('steals a stale foreign in-progress claim when no pending cells remain', async () => {
    const cfg = uniqueConfigName('steal-fallback');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [3],
      totalSeats: 4,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true,
    });

    // Drain the cycle: claim+complete the first 3 of 4 cells.
    const cellsClaimed: Array<{ rotation: number; seedIndex: number }> = [];
    for (let i = 0; i < 3; i++) {
      const c = await mustClaim(mgr);
      cellsClaimed.push({ rotation: c.rotation, seedIndex: c.seedIndex });
      await mgr.releaseCell(c, true, true);
    }

    // Claim the 4th cell, then forge it as a stale foreign in-progress claim.
    const fourth = await mustClaim(mgr);
    const r = String(fourth.rotation);
    const s = String(fourth.seedIndex);
    const state = readState(cfg);
    state.cells[r][s] = {
      status: 'in-progress',
      claimedBy: 'foreign-host#9999',
      claimedAt: new Date(Date.now() - 80 * 60 * 60 * 1000).toISOString(),
      failureCount: 2,
    };
    writeStateFile(cfg, state);

    // No pending cells remain — only the stale foreign one is claimable.
    const stolen = await mustClaim(mgr);
    expect(stolen.rotation).toBe(fourth.rotation);
    expect(stolen.seedIndex).toBe(fourth.seedIndex);

    // The steal must flip claimedBy back to us and bump failureCount by 1.
    const after = readState(cfg);
    const cell = after.cells[r][s];
    const expectedRunner = `${os.hostname()}#${process.pid}`;
    expect(cell.status).toBe('in-progress');
    expect(cell.claimedBy).toBe(expectedRunner);
    expect(cell.failureCount).toBe(3);
  });
});

describe('SeatingStateManager — no-claim outcomes', () => {
  it('claimNextCell returns null after a fully completed cycle when rollover is disabled', async () => {
    const cfg = uniqueConfigName('finished-no-rollover');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [3],
      totalSeats: 4,
      seedCount: 2,
      seedSets: [{ sync: 1, map: 1 }, { sync: 2, map: 2 }],
      randomizeSeating: true,
      resetCompletedCycles: false,
    });

    for (let i = 0; i < 8; i++) {
      const c = await mustClaim(mgr);
      await mgr.releaseCell(c, true, true);
    }

    const next = await mgr.claimNextCell();
    expect(next).toBeNull();

    const state = readState(cfg);
    expect(state.completedCycles).toBe(0);
  });

  it('claimNextCell returns null when every cell is terminal with at least one failed', async () => {
    const cfg = uniqueConfigName('finished-with-failures');
    // Tiny cycle (4 cells) with a zero-tolerance failure budget so the very
    // first non-success release flips a cell to `failed`.
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [3],
      totalSeats: 4,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: true,
      maxCellFailures: 1,
    });

    // First claim → release as failure → that cell is now terminal `failed`.
    const failing = await mustClaim(mgr);
    await mgr.releaseCell(failing, false);
    const failedCellStatus = readState(cfg)
      .cells[String(failing.rotation)][String(failing.seedIndex)].status;
    expect(failedCellStatus).toBe('failed');

    // Complete the remaining three cells. After this every cell is terminal —
    // 3 `completed` + 1 `failed` — and the cycle can't auto-reset (failed
    // blocks `allCompleted`).
    for (let i = 0; i < 3; i++) {
      const c = await mustClaim(mgr);
      await mgr.releaseCell(c, true, true);
    }

    // No more work. claimNextCell should return null instead of blocking or
    // throwing.
    const next = await mgr.claimNextCell();
    expect(next).toBeNull();
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

    const claim = await mustClaim(mgr);

    // configSlot N → seat N — no permutation.
    expect(claim.rotation).toBe(0);
    expect(claim.seedIndex).toBe(0);
    expect(claim.seatingMap).toEqual({ '0': 0, '2': 2, '5': 5 });
    expect(claim.seeds).toEqual({ sync: 42 });

    // No state file should have been written.
    expect(fs.existsSync(path.join(tmpRoot, `${cfg}.seating.json`))).toBe(false);
  });

  it('treats releaseCell and attachGameID as no-ops in trivial mode', async () => {
    const cfg = uniqueConfigName('trivial-noop');
    const mgr = new SeatingStateManager({
      configName: cfg,
      configSlots: [3],
      totalSeats: 4,
      seedCount: 1,
      seedSets: [undefined],
      randomizeSeating: false,
    });

    const claim = await mustClaim(mgr);

    // Both methods should resolve without throwing and without creating a state file.
    await mgr.releaseCell(claim, true, true);
    await mgr.attachGameID(claim, 'game-abc');

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

    await mustClaim(mgr);
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

    await mustClaim(mgr);
    expect(fs.existsSync(path.join(tmpRoot, `${cfg}.seating.json`))).toBe(true);
  });
});

describe('SeatingStateManager — seeded randomizeSeating', () => {
  /** Run a full N-cycle and return the sequence of (rotation, seedIndex, seat) tuples in order. */
  async function runFullCycle(mgr: SeatingStateManager, totalSeats: number, configSlot: number) {
    const sequence: Array<{ rotation: number; seedIndex: number; seat: number }> = [];
    for (let i = 0; i < totalSeats; i++) {
      const claim = await mustClaim(mgr);
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
      const c = await mustClaim(mgrA);
      await mgrA.releaseCell(c, true);
    }
    // Trigger reset → completedCycles bumps to 1.
    const ninth = await mustClaim(mgrA);
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
    await mustClaim(mgrB);
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
    await mustClaim(mgrSeeded);
    expect(readState(cfg).seatingSeed).toBe(42);

    // `true` is an alias for seed 0 → drift detected against persisted 42.
    const mgrTrue = new SeatingStateManager({
      configName: cfg, configSlots: [7], totalSeats: 8,
      seedCount: 1, seedSets: [undefined], randomizeSeating: true
    });
    await mustClaim(mgrTrue);
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
      const c = await mustClaim(mgrA);
      await mgrA.releaseCell(c, true);
    }
    const cycle1BasePerm = [...readState(cfgA).basePerm];
    await mustClaim(mgrA); // forces resetCycleInPlace
    const cycle2BasePerm = [...readState(cfgA).basePerm];
    expect(readState(cfgA).completedCycles).toBe(1);
    expect(cycle2BasePerm).not.toEqual(cycle1BasePerm);

    // A second manager run from scratch with the same seed should reproduce
    // the same cycle #2 basePerm once it crosses the reset boundary.
    const mgrB = new SeatingStateManager({ configName: cfgB, ...opts });
    for (let i = 0; i < 8; i++) {
      const c = await mustClaim(mgrB);
      await mgrB.releaseCell(c, true);
    }
    await mustClaim(mgrB);
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
    return expect(mgr.claimNextCell()).resolves.not.toBeNull();
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

describe('seatingMapsEqual', () => {
  it('compares maps by content, independent of key order', () => {
    expect(seatingMapsEqual({ '3': 1, '5': 2 }, { '3': 1, '5': 2 })).toBe(true);
    expect(seatingMapsEqual({ '5': 2, '3': 1 }, { '3': 1, '5': 2 })).toBe(true);
    expect(seatingMapsEqual({}, {})).toBe(true);
    expect(seatingMapsEqual({ '3': 1, '5': 2 }, { '3': 1, '5': 9 })).toBe(false);
    expect(seatingMapsEqual({ '3': 1 }, { '3': 1, '5': 2 })).toBe(false);
    expect(seatingMapsEqual({ '3': 1, '5': 2 }, { '3': 1 })).toBe(false);
  });
});

describe('SeatingStateManager — claimMatchingCell (load/wait resume)', () => {
  const ourId = `${os.hostname()}#${process.pid}`;

  /** Overwrite the on-disk state file in place (to forge a terminated claim). */
  function writeStateFile(configName: string, state: SeatingState): void {
    fs.writeFileSync(
      path.join(tmpRoot, `${configName}.seating.json`),
      JSON.stringify(state, null, 2)
    );
  }

  it('returns the identity claim in trivial mode, ignoring observed input', async () => {
    const cfg = uniqueConfigName('match-trivial');
    const mgr = new SeatingStateManager({
      configName: cfg, configSlots: [0, 2, 5], totalSeats: 8,
      seedCount: 1, seedSets: [{ sync: 42 }], randomizeSeating: false,
    });

    const claim = await mgr.claimMatchingCell({
      seatingMap: { '0': 0, '2': 2, '5': 5 }, seeds: { sync: 42 }, rotation: 0, seedIndex: 0,
    });

    expect(claim.rotation).toBe(0);
    expect(claim.seatingMap).toEqual({ '0': 0, '2': 2, '5': 5 });
    expect(claim.seeds).toEqual({ sync: 42 });
    // Trivial mode never persists state.
    expect(fs.existsSync(path.join(tmpRoot, `${cfg}.seating.json`))).toBe(false);
  });

  it('claims the cell matching the loaded game via an exact rotation hint', async () => {
    const cfg = uniqueConfigName('match-exact');
    const mgr = new SeatingStateManager({
      configName: cfg, configSlots: [7], totalSeats: 8,
      seedCount: 1, seedSets: [undefined], randomizeSeating: 12345,
    });
    // Materialize the state file so we can read its deterministic basePerm.
    await mgr.claimNextCell();
    const basePerm = readState(cfg).basePerm;
    const rotation = 3;
    const observedMap = buildSeatingMap(basePerm, rotation, [7]);

    const claim = await mgr.claimMatchingCell({
      seatingMap: observedMap, rotation, seedIndex: 0, seeds: { sync: undefined, map: undefined },
    });

    expect(claim.rotation).toBe(rotation);
    expect(claim.seedIndex).toBe(0);
    expect(claim.seatingMap).toEqual(observedMap);
    const cell = readState(cfg).cells[String(rotation)]['0'];
    expect(cell.status).toBe('in-progress');
    expect(cell.claimedBy).toBe(ourId);
  });

  it('falls back to scanning rotations when the hint is absent', async () => {
    const cfg = uniqueConfigName('match-scan');
    const mgr = new SeatingStateManager({
      configName: cfg, configSlots: [3, 5], totalSeats: 8,
      seedCount: 1, seedSets: [undefined], randomizeSeating: 7,
    });
    await mgr.claimNextCell();
    const basePerm = readState(cfg).basePerm;
    const rotation = 4;
    const observedMap = buildSeatingMap(basePerm, rotation, [3, 5]);

    // No rotation hint — must resolve purely by seating-map content.
    const claim = await mgr.claimMatchingCell({ seatingMap: observedMap });

    expect(claim.rotation).toBe(rotation);
    expect(claim.seatingMap).toEqual(observedMap);
  });

  it('resolves seedIndex via the seatingSeedIndex hint (multi-seed)', async () => {
    const cfg = uniqueConfigName('match-multiseed-hint');
    const seedSets = [{ sync: 1, map: 1 }, { sync: 2, map: 2 }, { sync: 3, map: 3 }];
    const mgr = new SeatingStateManager({
      configName: cfg, configSlots: [7], totalSeats: 8, seedCount: 3, seedSets, randomizeSeating: true,
    });
    await mgr.claimNextCell();
    const basePerm = readState(cfg).basePerm;
    const rotation = 2, seedIndex = 1;
    const observedMap = buildSeatingMap(basePerm, rotation, [7]);

    const claim = await mgr.claimMatchingCell({
      seatingMap: observedMap, rotation, seedIndex, seeds: seedSets[seedIndex],
    });

    expect(claim.rotation).toBe(rotation);
    expect(claim.seedIndex).toBe(seedIndex);
    expect(claim.seeds).toEqual(seedSets[seedIndex]);
  });

  it('resolves seedIndex by matching observed seeds when no hint is given', async () => {
    const cfg = uniqueConfigName('match-multiseed-scan');
    const seedSets = [{ sync: 1, map: 1 }, { sync: 2, map: 2 }, { sync: 3, map: 3 }];
    const mgr = new SeatingStateManager({
      configName: cfg, configSlots: [7], totalSeats: 8, seedCount: 3, seedSets, randomizeSeating: true,
    });
    await mgr.claimNextCell();
    const basePerm = readState(cfg).basePerm;
    const rotation = 5;
    const observedMap = buildSeatingMap(basePerm, rotation, [7]);

    const claim = await mgr.claimMatchingCell({
      seatingMap: observedMap, seeds: { sync: 3, map: 3 },
    });

    expect(claim.rotation).toBe(rotation);
    expect(claim.seedIndex).toBe(2);
    expect(claim.seeds).toEqual({ sync: 3, map: 3 });
  });

  it('matches an unfixed ("Civ chose") seed set and carries undefined seeds', async () => {
    const cfg = uniqueConfigName('match-unfixed-seed');
    const seedSets = [undefined, { sync: 5 }];
    const mgr = new SeatingStateManager({
      configName: cfg, configSlots: [7], totalSeats: 8, seedCount: 2, seedSets, randomizeSeating: true,
    });
    await mgr.claimNextCell();
    const basePerm = readState(cfg).basePerm;
    const rotation = 1, seedIndex = 0;
    const observedMap = buildSeatingMap(basePerm, rotation, [7]);

    // Whatever Civ rolled for the unfixed index must not be promoted into the claim.
    const claim = await mgr.claimMatchingCell({
      seatingMap: observedMap, rotation, seedIndex, seeds: { sync: 99999, map: 12345 },
    });

    expect(claim.seedIndex).toBe(0);
    expect(claim.seeds).toBeUndefined();
  });

  it('throws when the launched game has no seating map (unknown/fresh game)', async () => {
    const cfg = uniqueConfigName('match-no-map');
    const mgr = new SeatingStateManager({
      configName: cfg, configSlots: [7], totalSeats: 8,
      seedCount: 1, seedSets: [undefined], randomizeSeating: true,
    });

    await expect(mgr.claimMatchingCell({ seeds: { sync: 1 } })).rejects.toThrow(/no seating metadata/i);
    await expect(mgr.claimMatchingCell({ seatingMap: {} })).rejects.toThrow(/no seating metadata/i);
  });

  it('throws when no rotation reproduces the seating map (cycle drift)', async () => {
    const cfg = uniqueConfigName('match-drift');
    const mgr = new SeatingStateManager({
      configName: cfg, configSlots: [3, 5], totalSeats: 8,
      seedCount: 1, seedSets: [undefined], randomizeSeating: true,
    });
    await mgr.claimNextCell();

    // {3:0, 5:0} maps both slots to the same seat — impossible for any rotation.
    await expect(mgr.claimMatchingCell({ seatingMap: { '3': 0, '5': 0 } }))
      .rejects.toThrow(/reproduces|drift|refusing/i);
  });

  it('fails recovery when a recorded rotation hint no longer matches (no silent rescan)', async () => {
    const cfg = uniqueConfigName('match-hint-drift');
    const mgr = new SeatingStateManager({
      configName: cfg, configSlots: [7], totalSeats: 8,
      seedCount: 1, seedSets: [undefined], randomizeSeating: 4242,
    });
    await mgr.claimNextCell();
    const basePerm = readState(cfg).basePerm;
    // The observed map corresponds to one rotation, but the recorded hint claims
    // a different one. A blind scan WOULD find the real rotation (with one config
    // slot every seat is reachable), so the mismatched hint must veto it — drift,
    // not a silent rebind.
    const actualRotation = 2;
    const observedMap = buildSeatingMap(basePerm, actualRotation, [7]);
    const wrongHint = (actualRotation + 1) % 8;
    expect(seatingMapsEqual(buildSeatingMap(basePerm, wrongHint, [7]), observedMap)).toBe(false);

    await expect(
      mgr.claimMatchingCell({ seatingMap: observedMap, rotation: wrongHint, seedIndex: 0 })
    ).rejects.toThrow(/Refusing to assign a different cell/);
  });

  it('fails recovery when a recorded seedIndex hint no longer matches its seeds', async () => {
    const cfg = uniqueConfigName('match-seed-hint-drift');
    const seedSets = [{ sync: 1, map: 1 }, { sync: 2, map: 2 }];
    const mgr = new SeatingStateManager({
      configName: cfg, configSlots: [7], totalSeats: 8, seedCount: 2, seedSets, randomizeSeating: true,
    });
    await mgr.claimNextCell();
    const basePerm = readState(cfg).basePerm;
    const rotation = 1;
    const observedMap = buildSeatingMap(basePerm, rotation, [7]);
    // Observed seeds are seedSets[0], but the recorded hint claims index 1 — the
    // randomSeeds config drifted (reordered), so recovery must fail rather than
    // rebind to the wrong seed cell.
    await expect(
      mgr.claimMatchingCell({ seatingMap: observedMap, rotation, seedIndex: 1, seeds: { sync: 1, map: 1 } })
    ).rejects.toThrow(/Refusing to assign a different cell/);
  });

  it('re-owns a terminated in-progress cell without charging the failure budget', async () => {
    const cfg = uniqueConfigName('match-reown');
    const mgr = new SeatingStateManager({
      configName: cfg, configSlots: [7], totalSeats: 8,
      seedCount: 1, seedSets: [undefined], randomizeSeating: 999,
    });
    // First claim materializes state and gives us a concrete cell to forge.
    const original = await mustClaim(mgr);
    const r = String(original.rotation), s = String(original.seedIndex);
    const oldClaimedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Simulate a hard-terminated run: the cell is left in-progress under a dead
    // runner, mid-game, with prior failures on the books.
    const state = readState(cfg);
    state.cells[r][s] = {
      status: 'in-progress', claimedBy: 'dead-host#1234', claimedAt: oldClaimedAt,
      gameID: 'game-xyz', failureCount: 2,
    };
    writeStateFile(cfg, state);

    const claim = await mgr.claimMatchingCell({
      seatingMap: original.seatingMap, rotation: original.rotation, seedIndex: original.seedIndex,
    });

    expect(claim.rotation).toBe(original.rotation);
    expect(claim.seedIndex).toBe(original.seedIndex);

    const cell = readState(cfg).cells[r][s];
    expect(cell.status).toBe('in-progress');
    expect(cell.claimedBy).toBe(ourId);          // re-owned by us
    expect(cell.failureCount).toBe(2);           // preserved, NOT bumped
    expect(cell.gameID).toBe('game-xyz');        // preserved for forensics
    expect(cell.claimedAt).not.toBe(oldClaimedAt); // fresh timestamp
    expect(claim.claimedAt).toBe(cell.claimedAt);  // claim carries the on-disk claimedAt
  });
});
