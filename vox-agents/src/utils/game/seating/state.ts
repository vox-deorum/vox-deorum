/**
 * @module utils/game/seating/state
 *
 * Persistent, distributed-safe scheduler for the seating × seed cycle used by
 * the strategist session.
 *
 * # Why this exists
 *
 * The strategist session can be run with `randomizeSeating: true` to scatter
 * configured LLM players across the game's player slots, and with a multi-entry
 * `randomSeeds` array to vary Civ V map/sync seeds across runs. Pure
 * `Math.random()` shuffling gives no coverage guarantees — across 8 games an
 * LLM player could land in seat 7 every time. This module fixes that by
 * scheduling a deterministic, randomized cycle:
 *
 *   - **N seat rotations** — circular shifts of a random base permutation
 *     `basePerm` of `[0..N-1]`. For rotation `r`, the i-th configured slot is
 *     placed at `basePerm[(r + i) mod N]`. After N successful runs each
 *     configured slot has visited each seat exactly once (Latin-square property
 *     of circular shifts).
 *
 *   - **M seed sets** — entries of `randomSeeds`, or a single virtual entry
 *     when no array is configured.
 *
 * A "cycle" is the cartesian product: `N × M` cells, each consumed by exactly
 * one successful game before the cycle resets with a fresh `basePerm`.
 *
 * # Failure handling
 *
 * Cells track per-cell status (`pending`, `in-progress`, `completed`) rather
 * than a single monotonic counter. A crashed/aborted game releases its cell
 * back to `pending` so it can be retried — the cycle therefore reflects N×M
 * **successful** runs, not N×M starts.
 *
 * # Distributed cooperation
 *
 * State lives in `<CONFIGS_DIR>/<configName>.seating.json`. Multiple processes
 * pointed at the same shared `CONFIGS_DIR` cooperate via an exclusive-create
 * lock file (`*.seating.json.lock`). All read-modify-write is atomic under the
 * lock. Stale-lock recovery and stale-claim reclaim handle dead processes.
 *
 * # Code layout
 *
 * This file is intentionally thin — it's the public manager class. The actual
 * mechanics live in three sibling modules:
 *   - [`./cycle.js`](cycle.ts) — pure cycle math (shuffles, fresh-state, reset).
 *   - [`./cells.js`](cells.ts) — pure cell ops (pickCell, get/setCell, status checks).
 *   - [`./io.js`](io.ts)       — file lock + atomic state read/write + load/init.
 */

import os from 'os';
import path from 'path';
import { createLogger } from '../../logger.js';
import { getConfigsDir } from '../../config.js';
import { resetCycleInPlace } from './cycle.js';
import {
  allCompleted,
  buildSeatingMap,
  getCell,
  pickCell,
  setCell,
} from './cells.js';
import {
  loadOrInit,
  readStateUnlocked,
  withLock,
  writeStateUnlocked,
} from './io.js';
import type {
  SeatingClaim,
  SeatingStateManagerOptions,
} from './types.js';

const logger = createLogger('SeatingState');

/** Identifier embedded in `claimedBy` so we can distinguish our own crashes from others'. */
function runnerId(): string {
  return `${os.hostname()}#${process.pid}`;
}

/**
 * Manages the persistent seating × seed cycle for one strategist config.
 *
 * Construction is cheap and side-effect-free: it only stores parameters and
 * pre-computes paths. The disk is touched the first time a public method is
 * called.
 *
 * One manager corresponds to one config name — instances are not interchangeable.
 * Distinct configs (or distinct `(N, K, M)` shapes for the same name) use
 * separate state files automatically.
 */
export class SeatingStateManager {
  private readonly configName: string;
  /** Sorted ascending — fixes the "i-th configured slot" ordering used by `buildSeatingMap`. */
  private readonly configSlotsSorted: number[];
  private readonly totalSeats: number;
  private readonly seedCount: number;
  private readonly seedSets: SeatingStateManagerOptions['seedSets'];
  private readonly statePath: string;
  private readonly lockPath: string;

  constructor(opts: SeatingStateManagerOptions) {
    if (opts.totalSeats <= 0) {
      throw new Error(`SeatingStateManager: totalSeats must be > 0, got ${opts.totalSeats}`);
    }
    if (opts.configSlots.length === 0) {
      throw new Error('SeatingStateManager: configSlots must contain at least one entry');
    }
    if (opts.configSlots.length > opts.totalSeats) {
      throw new Error(
        `SeatingStateManager: configSlots (${opts.configSlots.length}) exceeds totalSeats (${opts.totalSeats})`
      );
    }
    for (const slot of opts.configSlots) {
      if (!Number.isInteger(slot) || slot < 0 || slot >= opts.totalSeats) {
        throw new Error(
          `SeatingStateManager: configSlot ${slot} is out of range [0, ${opts.totalSeats})`
        );
      }
    }
    if (opts.seedCount < 1) {
      throw new Error(`SeatingStateManager: seedCount must be >= 1, got ${opts.seedCount}`);
    }
    if (opts.seedSets.length !== opts.seedCount) {
      throw new Error(
        `SeatingStateManager: seedSets.length (${opts.seedSets.length}) must equal seedCount (${opts.seedCount})`
      );
    }

    this.configName = opts.configName;
    this.configSlotsSorted = [...opts.configSlots].sort((a, b) => a - b);
    this.totalSeats = opts.totalSeats;
    this.seedCount = opts.seedCount;
    this.seedSets = opts.seedSets;
    this.statePath = path.join(getConfigsDir(), `${this.configName}.seating.json`);
    this.lockPath = `${this.statePath}.lock`;
  }

  /**
   * Atomically pick the next cell to run and mark it `in-progress`.
   *
   * Selection priority (under file lock):
   *   1. Own in-progress cell (claimedBy === ourId) — i.e. we crashed before
   *      releasing; resume on the same cell.
   *   2. Stale in-progress cell (older than the stale threshold) — assumed
   *      abandoned by some other runner; we steal it.
   *   3. Next pending cell in the shuffled `consumeOrder`.
   *   4. If every cell is `completed`, reset the cycle (regenerate `basePerm`
   *      and `consumeOrder`, increment `completedCycles`) and pick the first
   *      cell of the new cycle.
   *
   * @returns A {@link SeatingClaim} carrying everything the session needs to
   *   start the game (resolved seating map, seed set, claim metadata).
   */
  async claimNextCell(): Promise<SeatingClaim> {
    const ourId = runnerId();
    return withLock(this.lockPath, ourId, this.configName, () => {
      const state = loadOrInit({
        statePath: this.statePath,
        configName: this.configName,
        totalSeats: this.totalSeats,
        seedCount: this.seedCount,
        configSlotsSorted: this.configSlotsSorted,
      });
      const now = Date.now();

      let pick = pickCell(state, ourId, now);
      if (!pick) {
        // No claimable cell means the cycle is fully completed — start a new one.
        if (allCompleted(state)) {
          resetCycleInPlace(state);
          logger.warn(
            `Seating cycle "${this.configName}" completed (cycle #${state.completedCycles}); regenerated for next cycle`
          );
          pick = pickCell(state, ourId, now);
        }
      }
      if (!pick) {
        // Defensive — every fresh cycle has pending cells.
        throw new Error(`No claimable cell in seating state "${this.configName}"`);
      }

      const { rotation, seedIndex } = pick;
      const claimedAt = new Date(now).toISOString();
      setCell(state, rotation, seedIndex, {
        status: 'in-progress',
        claimedAt,
        claimedBy: ourId
      });
      writeStateUnlocked(this.statePath, state);

      const seatingMap = buildSeatingMap(state.basePerm, rotation, this.configSlotsSorted);
      const seeds = this.seedSets[seedIndex];

      logger.info(
        `Claimed seating cell rotation=${rotation} seedIndex=${seedIndex} for "${this.configName}" ` +
        `(seatingMap=${JSON.stringify(seatingMap)}, completedCycles=${state.completedCycles})`
      );

      return { rotation, seedIndex, seatingMap, seeds, claimedAt };
    });
  }

  /**
   * Atomically release a claim. On success the cell becomes `completed`;
   * otherwise it returns to `pending` so the same cycle can retry it.
   *
   * If the on-disk cell has been overwritten since we claimed it (claimedAt
   * mismatch) the release is a no-op — another runner has already taken the
   * slot, and trampling them would corrupt the cycle.
   *
   * Safe to call even if the state file has been deleted between claim and
   * release (logs a warning and returns).
   */
  async releaseCell(claim: SeatingClaim, success: boolean): Promise<void> {
    const ourId = runnerId();
    return withLock(this.lockPath, ourId, this.configName, () => {
      const existing = readStateUnlocked(this.statePath);
      if (!existing) {
        logger.warn(`State file for "${this.configName}" missing on release; ignoring`);
        return;
      }
      const cell = getCell(existing, claim.rotation, claim.seedIndex);
      if (cell.status !== 'in-progress' || cell.claimedAt !== claim.claimedAt) {
        logger.warn(
          `Skipping release for "${this.configName}" cell rotation=${claim.rotation} seedIndex=${claim.seedIndex}: ` +
          `state has status=${cell.status} claimedAt=${cell.claimedAt} ` +
          `(expected in-progress @ ${claim.claimedAt})`
        );
        return;
      }
      setCell(existing, claim.rotation, claim.seedIndex, {
        status: success ? 'completed' : 'pending'
      });
      writeStateUnlocked(this.statePath, existing);
      logger.info(
        `Released cell rotation=${claim.rotation} seedIndex=${claim.seedIndex} for "${this.configName}" ` +
        `as ${success ? 'completed' : 'pending'}`
      );
    });
  }

  /**
   * Returns true iff every cell of the current cycle is `completed`. Used by
   * the auto-repetition loop to know when to stop. Read-only but still goes
   * through the lock to avoid observing a torn state mid-write.
   */
  async isCycleComplete(): Promise<boolean> {
    const ourId = runnerId();
    return withLock(this.lockPath, ourId, this.configName, () => {
      const state = loadOrInit({
        statePath: this.statePath,
        configName: this.configName,
        totalSeats: this.totalSeats,
        seedCount: this.seedCount,
        configSlotsSorted: this.configSlotsSorted,
      });
      return allCompleted(state);
    });
  }
}
