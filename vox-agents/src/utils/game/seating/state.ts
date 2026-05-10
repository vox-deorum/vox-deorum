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
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { setTimeout } from 'node:timers/promises';
import { createLogger } from '../../logger.js';
import { getConfigsDir } from '../../config.js';
import type {
  CellEntry,
  SeatingClaim,
  SeatingState,
  SeatingStateManagerOptions,
} from './types.js';

const logger = createLogger('SeatingState');

// ---------------------------------------------------------------------------
// Tunables (module-private)
// ---------------------------------------------------------------------------

/** How long another runner's in-progress claim can sit before we steal it. */
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/** How long a `.lock` file can exist before we treat it as orphaned. */
const LOCK_STALE_THRESHOLD_MS = 60 * 1000; // 60 seconds — well above any normal RMW

/** Lock acquisition retry tuning (exponential backoff capped at LOCK_MAX_DELAY_MS). */
const LOCK_INITIAL_DELAY_MS = 50;
const LOCK_MAX_DELAY_MS = 1000;
const LOCK_MAX_ATTEMPTS = 20;

// ---------------------------------------------------------------------------
// Module-private utilities
// ---------------------------------------------------------------------------

/** Identifier embedded in `claimedBy` so we can distinguish our own crashes from others'. */
function runnerId(): string {
  return `${os.hostname()}#${process.pid}`;
}

/** In-place-safe Fisher-Yates shuffle returning a new array. */
function fisherYates<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// SeatingStateManager
// ---------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Atomically pick the next cell to run and mark it `in-progress`.
   *
   * Selection priority (under file lock):
   *   1. Own in-progress cell (claimedBy === ourId) — i.e. we crashed before
   *      releasing; resume on the same cell.
   *   2. Stale in-progress cell (older than {@link STALE_THRESHOLD_MS}) — assumed
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
    return this.withLock(() => {
      const state = this.loadOrInit();
      const ourId = runnerId();
      const now = Date.now();

      let pick = this.pickCell(state, ourId, now);
      if (!pick) {
        // No claimable cell means the cycle is fully completed — start a new one.
        if (this.allCompleted(state)) {
          this.resetCycleInPlace(state);
          logger.warn(
            `Seating cycle "${this.configName}" completed (cycle #${state.completedCycles}); regenerated for next cycle`
          );
          pick = this.pickCell(state, ourId, now);
        }
      }
      if (!pick) {
        // Defensive — every fresh cycle has pending cells.
        throw new Error(`No claimable cell in seating state "${this.configName}"`);
      }

      const { r, s } = pick;
      const claimedAt = new Date(now).toISOString();
      this.setCell(state, r, s, { status: 'in-progress', claimedAt, claimedBy: ourId });
      this.writeStateUnlocked(state);

      const seatingMap = this.buildSeatingMap(state.basePerm, r);
      const seeds = this.seedSets[s];

      logger.info(
        `Claimed seating cell r=${r} s=${s} for "${this.configName}" ` +
        `(seatingMap=${JSON.stringify(seatingMap)}, completedCycles=${state.completedCycles})`
      );

      return { rotation: r, seedIndex: s, seatingMap, seeds, claimedAt };
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
    return this.withLock(() => {
      const existing = this.readStateUnlocked();
      if (!existing) {
        logger.warn(`State file for "${this.configName}" missing on release; ignoring`);
        return;
      }
      const cell = this.getCell(existing, claim.rotation, claim.seedIndex);
      if (cell.status !== 'in-progress' || cell.claimedAt !== claim.claimedAt) {
        logger.warn(
          `Skipping release for "${this.configName}" cell r=${claim.rotation} s=${claim.seedIndex}: ` +
          `state has status=${cell.status} claimedAt=${cell.claimedAt} ` +
          `(expected in-progress @ ${claim.claimedAt})`
        );
        return;
      }
      this.setCell(existing, claim.rotation, claim.seedIndex, {
        status: success ? 'completed' : 'pending'
      });
      this.writeStateUnlocked(existing);
      logger.info(
        `Released cell r=${claim.rotation} s=${claim.seedIndex} for "${this.configName}" ` +
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
    return this.withLock(() => {
      const state = this.loadOrInit();
      return this.allCompleted(state);
    });
  }

  // -------------------------------------------------------------------------
  // Lock helpers
  // -------------------------------------------------------------------------

  /**
   * Acquire the per-config file lock via exclusive create. If the lock file
   * exists but is older than {@link LOCK_STALE_THRESHOLD_MS}, assume the
   * previous holder died and steal it. Otherwise retry with exponential
   * backoff up to {@link LOCK_MAX_ATTEMPTS}.
   */
  private async acquireLock(): Promise<void> {
    let attempt = 0;
    let delayMs = LOCK_INITIAL_DELAY_MS;

    while (true) {
      try {
        const fd = fs.openSync(this.lockPath, 'wx');
        fs.writeSync(fd, runnerId());
        fs.closeSync(fd);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') throw err;

        // Stale-lock recovery: if the existing lock is older than threshold,
        // its holder probably died without cleanup — remove and retry.
        try {
          const stat = fs.statSync(this.lockPath);
          if (Date.now() - stat.mtimeMs > LOCK_STALE_THRESHOLD_MS) {
            logger.warn(`Removing stale lock file ${this.lockPath}`);
            fs.unlinkSync(this.lockPath);
            continue;
          }
        } catch {
          // Lock disappeared between EEXIST and stat — retry the open immediately.
          continue;
        }

        attempt++;
        if (attempt >= LOCK_MAX_ATTEMPTS) {
          throw new Error(
            `Failed to acquire seating-state lock after ${attempt} attempts: ${this.lockPath}`
          );
        }
        await setTimeout(delayMs);
        delayMs = Math.min(delayMs * 2, LOCK_MAX_DELAY_MS);
      }
    }
  }

  /** Best-effort lock release; tolerates the file already being gone. */
  private releaseLock(): void {
    try {
      fs.unlinkSync(this.lockPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logger.warn(`Failed to release lock for ${this.configName}: ${(err as Error).message}`);
      }
    }
  }

  /** Run `fn` while holding the file lock. The lock is always released. */
  private async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    await this.acquireLock();
    try {
      return await fn();
    } finally {
      this.releaseLock();
    }
  }

  // -------------------------------------------------------------------------
  // State I/O (must be called under the file lock)
  // -------------------------------------------------------------------------

  /**
   * Read state from disk, or return null on missing/corrupt files. A corrupt
   * file is logged and treated as missing so we can recover gracefully.
   */
  private readStateUnlocked(): SeatingState | null {
    try {
      const raw = fs.readFileSync(this.statePath, 'utf8');
      return JSON.parse(raw) as SeatingState;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      logger.warn(
        `Failed to read seating state ${this.statePath}: ${(err as Error).message}; treating as fresh`
      );
      return null;
    }
  }

  /** Atomic write via temp file + rename — readers never see a torn JSON. */
  private writeStateUnlocked(state: SeatingState): void {
    const tmp = `${this.statePath}.tmp`;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.statePath);
  }

  /**
   * Load state and validate it matches the manager's `(totalSeats, configSlots,
   * seedCount)` shape. If the shape has drifted (config edited between runs)
   * or the file is malformed, regenerate a fresh cycle while preserving
   * `completedCycles` (so cumulative cycle counts remain meaningful).
   */
  private loadOrInit(): SeatingState {
    const existing = this.readStateUnlocked();

    if (
      existing &&
      existing.totalSeats === this.totalSeats &&
      existing.seedCount === this.seedCount &&
      Array.isArray(existing.configSlots) &&
      arraysEqual(existing.configSlots, this.configSlotsSorted)
    ) {
      // Defensive check: the schema shape may match but the contents could be
      // truncated (e.g., from an earlier crash mid-write before atomic rename
      // existed). Fall through to a fresh build if anything looks off.
      if (
        Array.isArray(existing.basePerm) &&
        existing.basePerm.length === this.totalSeats &&
        Array.isArray(existing.consumeOrder) &&
        existing.consumeOrder.length === this.totalSeats * this.seedCount &&
        typeof existing.completedCycles === 'number'
      ) {
        if (!existing.cells || typeof existing.cells !== 'object') existing.cells = {};
        return existing;
      }
      logger.warn(`Seating state for "${this.configName}" is malformed; regenerating`);
    } else if (existing) {
      logger.warn(
        `Seating state for "${this.configName}" is stale ` +
        `(totalSeats=${existing.totalSeats}/${this.totalSeats}, ` +
        `seedCount=${existing.seedCount}/${this.seedCount}, ` +
        `configSlots=${JSON.stringify(existing.configSlots)}/${JSON.stringify(this.configSlotsSorted)}); ` +
        `regenerating`
      );
    }

    return this.buildFreshState(existing?.completedCycles ?? 0);
  }

  // -------------------------------------------------------------------------
  // Cycle logic (pure operations on `SeatingState`)
  // -------------------------------------------------------------------------

  /** Build a fresh cycle: random `basePerm`, shuffled `consumeOrder`, no cells set. */
  private buildFreshState(completedCycles: number): SeatingState {
    const basePerm = fisherYates(Array.from({ length: this.totalSeats }, (_, i) => i));
    const allCells: Array<{ r: number; s: number }> = [];
    for (let r = 0; r < this.totalSeats; r++) {
      for (let s = 0; s < this.seedCount; s++) {
        allCells.push({ r, s });
      }
    }
    return {
      totalSeats: this.totalSeats,
      configSlots: [...this.configSlotsSorted],
      seedCount: this.seedCount,
      basePerm,
      consumeOrder: fisherYates(allCells),
      cells: {},
      completedCycles
    };
  }

  /** Regenerate `basePerm` and `consumeOrder` in place; bump `completedCycles`. */
  private resetCycleInPlace(state: SeatingState): void {
    state.basePerm = fisherYates(Array.from({ length: this.totalSeats }, (_, i) => i));
    const allCells: Array<{ r: number; s: number }> = [];
    for (let r = 0; r < this.totalSeats; r++) {
      for (let s = 0; s < this.seedCount; s++) {
        allCells.push({ r, s });
      }
    }
    state.consumeOrder = fisherYates(allCells);
    state.cells = {};
    state.completedCycles += 1;
  }

  /** Read a cell, treating missing inner/outer keys as `pending`. */
  private getCell(state: SeatingState, r: number, s: number): CellEntry {
    return state.cells[String(r)]?.[String(s)] ?? { status: 'pending' };
  }

  /** Write a cell, lazily creating the inner record. */
  private setCell(state: SeatingState, r: number, s: number, entry: CellEntry): void {
    const rk = String(r);
    if (!state.cells[rk]) state.cells[rk] = {};
    state.cells[rk][String(s)] = entry;
  }

  private isCellPending(entry: CellEntry): boolean {
    return entry.status === 'pending';
  }

  private isCellOwnInProgress(entry: CellEntry, ourId: string): boolean {
    return entry.status === 'in-progress' && entry.claimedBy === ourId;
  }

  private isCellStaleInProgress(entry: CellEntry, now: number): boolean {
    if (entry.status !== 'in-progress' || !entry.claimedAt) return false;
    return now - Date.parse(entry.claimedAt) > STALE_THRESHOLD_MS;
  }

  /** True iff every (r, s) cell is `completed`. */
  private allCompleted(state: SeatingState): boolean {
    for (let r = 0; r < this.totalSeats; r++) {
      for (let s = 0; s < this.seedCount; s++) {
        if (this.getCell(state, r, s).status !== 'completed') return false;
      }
    }
    return true;
  }

  /**
   * Implementation of the priority-ordered cell selection documented in
   * {@link claimNextCell}. Returns null if no cell is claimable (caller
   * decides whether to reset the cycle).
   */
  private pickCell(
    state: SeatingState,
    ourId: string,
    now: number
  ): { r: number; s: number } | null {
    // Priority 1: own in-progress (own crash recovery).
    for (const { r, s } of state.consumeOrder) {
      if (this.isCellOwnInProgress(this.getCell(state, r, s), ourId)) return { r, s };
    }
    // Priority 2: stale in-progress from someone else.
    for (const { r, s } of state.consumeOrder) {
      if (this.isCellStaleInProgress(this.getCell(state, r, s), now)) return { r, s };
    }
    // Priority 3: next pending cell in shuffled consumeOrder.
    for (const { r, s } of state.consumeOrder) {
      if (this.isCellPending(this.getCell(state, r, s))) return { r, s };
    }
    return null;
  }

  /**
   * Build the configSlot → seat map for a given rotation.
   *
   * For rotation `r`, the i-th configured slot (in sorted order) is assigned
   * `basePerm[(r + i) mod N]`. Across rotations 0..N-1 this gives every
   * configured slot a turn at every seat — the Latin-square coverage guarantee.
   */
  private buildSeatingMap(basePerm: number[], rotation: number): Record<string, number> {
    const N = basePerm.length;
    const seatingMap: Record<string, number> = {};
    for (let i = 0; i < this.configSlotsSorted.length; i++) {
      const seat = basePerm[(rotation + i) % N];
      seatingMap[String(this.configSlotsSorted[i])] = seat;
    }
    return seatingMap;
  }
}
