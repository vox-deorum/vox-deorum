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
 * Cells track per-cell status (`pending`, `in-progress`, `completed`, `failed`)
 * plus a `failureCount`. A crashed game / missing-archive game releases its
 * cell back to `pending` so it can be retried — but only up to
 * `maxCellFailures` total tries; past that the cell is marked `failed` and
 * excluded from future picks (terminal until a human edits the JSON). The
 * stale-steal path also bumps `failureCount`, so silent crashes (where the
 * runner died without releasing) count toward the budget.
 *
 * Completion is gated on archive success: `releaseCell` only marks a cell
 * `completed` when both `success` (victory observed) and `archived` (archive
 * notification was successful) are true.
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
import { setTimeout } from 'node:timers/promises';
import { createLogger } from '../../logger.js';
import { getConfigsDir } from '../../config.js';
import { processManager } from '../../../infra/process-manager.js';
import { resetCycleInPlace } from './cycle.js';
import {
  allCompleted,
  buildSeatingMap,
  getCell,
  getCellStatusCounts as countsHelper,
  isCycleFinished as cycleFinishedHelper,
  pickCell,
  setCell,
  type CellStatusCounts,
} from './cells.js';
import {
  loadOrInit,
  readStateUnlocked,
  withLock,
  writeStateUnlocked,
} from './io.js';
import type {
  CellEntry,
  CellStatus,
  SeatingClaim,
  SeatingCycleCell,
  SeatingState,
  SeatingStateManagerOptions,
} from './types.js';

const logger = createLogger('SeatingState');

/** Default per-cell failure budget when `maxCellFailures` isn't configured. */
const DEFAULT_MAX_CELL_FAILURES = 5;

/**
 * How long `claimNextCell` sleeps between attempts when no cell is claimable
 * right now (peers are still mid-game; nothing pending, nothing stale enough
 * to steal). The wait ends sooner if `processManager.isShuttingDown` flips.
 */
const SEATING_WAIT_RETRY_MS = 60_000;

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
  private readonly maxCellFailures: number;
  private readonly resetCompletedCycles: boolean;
  /**
   * Deterministic seed for `basePerm` / `consumeOrder`. Normalized to `0` for
   * `randomizeSeating: true` (and for the trivial/falsy path, where it's
   * never read). Validated as a non-negative uint32 in the constructor.
   */
  private readonly seatingSeed: number;
  private readonly statePath: string;
  private readonly lockPath: string;
  /**
   * True when the cycle has nothing to schedule — neither seat randomization
   * is requested nor multiple seed sets are configured. In this mode the
   * manager produces an in-memory identity claim per `claimNextCell()` call
   * and never touches the filesystem.
   */
  private readonly trivial: boolean;

  /**
   * Validate options and pre-compute paths + the trivial-mode flag. No disk
   * I/O — the state file is only touched on the first non-trivial public
   * call (`claimNextCell` / `releaseCell` / ...).
   */
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
    if (opts.maxCellFailures !== undefined && opts.maxCellFailures < 1) {
      throw new Error(
        `SeatingStateManager: maxCellFailures must be >= 1, got ${opts.maxCellFailures}`
      );
    }
    if (typeof opts.randomizeSeating === 'number') {
      const s = opts.randomizeSeating;
      if (!Number.isInteger(s) || s < 0 || s > 0xffffffff) {
        throw new Error(`SeatingStateManager: randomizeSeating must be a uint32 integer, got ${s}`);
      }
    }

    this.configName = opts.configName;
    this.configSlotsSorted = [...opts.configSlots].sort((a, b) => a - b);
    this.totalSeats = opts.totalSeats;
    this.seedCount = opts.seedCount;
    this.seedSets = opts.seedSets;
    this.maxCellFailures = opts.maxCellFailures ?? DEFAULT_MAX_CELL_FAILURES;
    this.resetCompletedCycles = opts.resetCompletedCycles ?? true;
    // `true` is an alias for seed 0. When seating is disabled (`false` /
    // `undefined`) the manager may still run a cycle for multi-seed configs;
    // in that case seatingSeed defaults to 0 and is never observed by callers.
    this.seatingSeed = typeof opts.randomizeSeating === 'number' ? opts.randomizeSeating : 0;
    this.statePath = path.join(getConfigsDir(), `${this.configName}.seating.json`);
    this.lockPath = `${this.statePath}.lock`;
    // Only literal `false`/`undefined` disable the cycle; `0` is a valid seed
    // that engages the cycle, same as any other number.
    const seatingDisabled = opts.randomizeSeating === undefined || opts.randomizeSeating === false;
    this.trivial = seatingDisabled && opts.seedCount === 1;
  }

  /**
   * Sentinel `claimedAt` returned for trivial-mode claims. Distinct from any
   * real ISO timestamp so a stray `releaseCell` against a trivial claim would
   * be detectable in logs if persistence were ever turned on later.
   */
  private static readonly TRIVIAL_CLAIMED_AT = 'trivial';

  /**
   * Synthesize the identity claim used in trivial mode. configSlot N is
   * placed at seat N (no permutation), and the single configured seed set is
   * returned as-is.
   */
  private buildTrivialClaim(): SeatingClaim {
    const seatingMap: Record<string, number> = {};
    for (const slot of this.configSlotsSorted) {
      seatingMap[String(slot)] = slot;
    }
    return {
      rotation: 0,
      seedIndex: 0,
      seatingMap,
      seeds: this.seedSets[0],
      claimedAt: SeatingStateManager.TRIVIAL_CLAIMED_AT,
    };
  }

  /**
   * Atomically pick the next cell to run and mark it `in-progress`.
   *
   * Selection priority (under file lock):
   *   1. Own in-progress cell — i.e. we crashed before releasing; resume on the same cell.
   *   2. Next pending cell in the shuffled `consumeOrder`.
   *   3. Stale in-progress cell from someone else (last-resort steal). Stealing
   *      counts as a silent crash: `failureCount` is incremented, and if it
   *      crosses `maxCellFailures` the cell is marked `failed` (skipped) instead.
   *   4. If every cell is strictly `completed`, either reset the cycle
   *      (regenerate `basePerm` and `consumeOrder`, increment
   *      `completedCycles`) and pick the first cell of the new cycle, or
   *      return `null` when `resetCompletedCycles` is disabled.
   *
   * Returns `null` when the cycle is *finished* — either every cell is
   * terminal and at least one is `failed`, or every cell completed while
   * `resetCompletedCycles` is disabled. Callers treat `null` as "stop calling
   * me; we're done".
   *
   * When no cell is pickable *right now* but the cycle isn't finished (peers
   * are still mid-game), this method sleeps for {@link SEATING_WAIT_RETRY_MS}
   * and retries — peers' releases will eventually surface a `pending` cell.
   * The wait short-circuits when `processManager.isShuttingDown` flips, in
   * which case we also return `null` so the caller exits cleanly.
   *
   * @returns A {@link SeatingClaim} carrying everything the session needs to
   *   start the game, or `null` if the cycle is finished / we're shutting down.
   */
  async claimNextCell(): Promise<SeatingClaim | null> {
    if (this.trivial) {
      // No persistent state in trivial mode — every call returns the same
      // identity claim. Callers can still `releaseCell`/`attachGameID` on it;
      // those are no-ops below.
      return this.buildTrivialClaim();
    }
    const ourId = runnerId();
    let loggedWait = false;

    while (!processManager.isShuttingDown) {
      const outcome = await withLock(this.lockPath, ourId, this.configName, () => {
        const state = loadOrInit({
          statePath: this.statePath,
          configName: this.configName,
          totalSeats: this.totalSeats,
          seedCount: this.seedCount,
          configSlotsSorted: this.configSlotsSorted,
          seatingSeed: this.seatingSeed,
        });
        const now = Date.now();
        const selected = this.selectClaimable(state, ourId, now);

        if (!selected) {
          return cycleFinishedHelper(state)
            ? { kind: 'finished' as const }
            : { kind: 'wait' as const };
        }

        const { pick, before, failureCount } = selected;
        const { rotation, seedIndex } = pick;
        const claimedAt = new Date(now).toISOString();
        setCell(state, rotation, seedIndex, {
          status: 'in-progress',
          claimedAt,
          claimedBy: ourId,
          // Preserve last gameID until GameSwitched calls attachGameID with the
          // relaunched game's id; useful audit data if we crash before then.
          gameID: before.gameID,
          // Preserve `completedBy` from a prior victory-but-no-archive attempt
          // so the attribution survives the retry; cleared once the new attempt
          // releases (either with success or with a non-victory failure).
          completedBy: before.completedBy,
          failureCount,
        });
        writeStateUnlocked(this.statePath, state);

        const seatingMap = buildSeatingMap(state.basePerm, rotation, this.configSlotsSorted);
        const seeds = this.seedSets[seedIndex];

        logger.info(
          `Claimed seating cell rotation=${rotation} seedIndex=${seedIndex} for "${this.configName}" ` +
          `(seatingMap=${JSON.stringify(seatingMap)}, completedCycles=${state.completedCycles}, ` +
          `failureCount=${failureCount ?? 0}/${this.maxCellFailures})`
        );

        const claim: SeatingClaim = { rotation, seedIndex, seatingMap, seeds, claimedAt };
        return { kind: 'claimed' as const, claim };
      });

      if (outcome.kind === 'claimed') return outcome.claim;
      if (outcome.kind === 'finished') {
        logger.info(`Seating cycle "${this.configName}" is finished — no more cells to claim`);
        return null;
      }
      // outcome.kind === 'wait'
      if (!loggedWait) {
        logger.info(
          `No claimable seating cell for "${this.configName}" yet (peers active); ` +
          `retrying every ${SEATING_WAIT_RETRY_MS / 1000}s`
        );
        loggedWait = true;
      }
      await setTimeout(SEATING_WAIT_RETRY_MS);
    }

    // Shutting down — treat as finished so the caller exits its loop.
    return null;
  }

  /**
   * Atomically release a claim.
   *
   * The cell becomes `completed` only when both `success` (a `PlayerVictory`
   * was observed) and `archived` (the MCP archive succeeded) are true. Any
   * other combination is treated as a failed attempt: `failureCount` is
   * incremented and the cell goes back to `pending`, or to terminal `failed`
   * once the count reaches `maxCellFailures`.
   *
   * If the on-disk cell has been overwritten since we claimed it (claimedAt
   * mismatch) the release is a no-op — another runner has already taken the
   * slot, and trampling them would corrupt the cycle. Safe to call even if
   * the state file has been deleted between claim and release.
   *
   * @param archived  Whether the MCP `GameArchived` notification reported
   *   success. When omitted, defaults to `success` for backward compatibility
   *   with call sites that pre-date the archive-gating change.
   */
  async releaseCell(claim: SeatingClaim, success: boolean, archived?: boolean): Promise<void> {
    if (this.trivial) return;
    const ourId = runnerId();
    const isArchived = archived ?? success;

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

      if (success && isArchived) {
        setCell(existing, claim.rotation, claim.seedIndex, {
          status: 'completed',
          gameID: cell.gameID,
          // failureCount is preserved as audit history — resetting would hide
          // chronic offenders that ultimately succeeded.
          failureCount: cell.failureCount,
          archivedAt: new Date().toISOString(),
          completedBy: ourId,
        });
        writeStateUnlocked(this.statePath, existing);
        logger.info(
          `Released cell rotation=${claim.rotation} seedIndex=${claim.seedIndex} for "${this.configName}" ` +
          `as completed (gameID=${cell.gameID ?? 'unknown'}, completedBy=${ourId}, failureCount=${cell.failureCount ?? 0})`
        );
        return;
      }

      // Failure branch (also covers victory-but-archive-missing).
      const archiveMiss = success && !isArchived;
      if (archiveMiss) {
        logger.warn(
          `Cell rotation=${claim.rotation} seedIndex=${claim.seedIndex} for "${this.configName}": ` +
          `victory observed but archive missing; treating as failure for retry`
        );
      }

      const newFailureCount = (cell.failureCount ?? 0) + 1;
      const newStatus: CellStatus = newFailureCount >= this.maxCellFailures ? 'failed' : 'pending';
      setCell(existing, claim.rotation, claim.seedIndex, {
        status: newStatus,
        gameID: cell.gameID, // preserve last attempted gameID for forensics
        failureCount: newFailureCount,
        // Record the runner on the archive-miss path so we keep attribution
        // for the next retry; clear it on non-victory failures (the cell will
        // be re-attempted from scratch and there's no completion to attribute).
        completedBy: archiveMiss ? ourId : cell.completedBy,
      });
      writeStateUnlocked(this.statePath, existing);
      logger.info(
        `Released cell rotation=${claim.rotation} seedIndex=${claim.seedIndex} for "${this.configName}" ` +
        `as ${newStatus} (failureCount=${newFailureCount}/${this.maxCellFailures})`
      );
    });
  }

  /**
   * Bind the gameID reported by Civ's `GameSwitched` to the in-progress cell
   * holding the supplied claim. Idempotent (re-setting the same gameID is a
   * no-op); crash-recovery within the same claim simply overwrites with the
   * relaunched game's id.
   *
   * No-ops with a warning if the cell has been stolen since the claim
   * (claimedAt mismatch) or if the state file has gone missing.
   */
  async attachGameID(claim: SeatingClaim, gameID: string): Promise<void> {
    if (this.trivial) return;
    const ourId = runnerId();
    return withLock(this.lockPath, ourId, this.configName, () => {
      const state = readStateUnlocked(this.statePath);
      if (!state) {
        logger.warn(`State file for "${this.configName}" missing on attachGameID; ignoring`);
        return;
      }
      const cell = getCell(state, claim.rotation, claim.seedIndex);
      if (cell.status !== 'in-progress' || cell.claimedAt !== claim.claimedAt) {
        logger.warn(
          `Skipping attachGameID for "${this.configName}" cell rotation=${claim.rotation} seedIndex=${claim.seedIndex}: ` +
          `state has status=${cell.status} claimedAt=${cell.claimedAt} ` +
          `(expected in-progress @ ${claim.claimedAt})`
        );
        return;
      }
      if (cell.gameID === gameID) return; // idempotent — skip the write
      setCell(state, claim.rotation, claim.seedIndex, { ...cell, gameID });
      writeStateUnlocked(this.statePath, state);
      logger.info(
        `Attached gameID=${gameID} to seating cell rotation=${claim.rotation} seedIndex=${claim.seedIndex} for "${this.configName}"`
      );
    });
  }

  /**
   * Returns true iff every cell of the current cycle is in a terminal state
   * (`completed` or `failed`). Used by the auto-repetition loop to exit cleanly
   * when failed cells block strict completion. Read-only but still goes through
   * the lock to avoid observing a torn state mid-write.
   */
  async isCycleFinished(): Promise<boolean> {
    if (this.trivial) return false;
    const ourId = runnerId();
    return withLock(this.lockPath, ourId, this.configName, () => {
      const state = loadOrInit({
        statePath: this.statePath,
        configName: this.configName,
        totalSeats: this.totalSeats,
        seedCount: this.seedCount,
        configSlotsSorted: this.configSlotsSorted,
        seatingSeed: this.seatingSeed,
      });
      return cycleFinishedHelper(state);
    });
  }

  /**
   * Returns true iff every cell of the current cycle is strictly `completed`.
   * Retained for the auto-repetition loop in `console.ts` until it's switched
   * to the more permissive {@link isCycleFinished}.
   */
  async isCycleComplete(): Promise<boolean> {
    if (this.trivial) return false;
    const ourId = runnerId();
    return withLock(this.lockPath, ourId, this.configName, () => {
      const state = loadOrInit({
        statePath: this.statePath,
        configName: this.configName,
        totalSeats: this.totalSeats,
        seedCount: this.seedCount,
        configSlotsSorted: this.configSlotsSorted,
        seatingSeed: this.seatingSeed,
      });
      return allCompleted(state);
    });
  }

  /** Aggregate cell counts by status across the current cycle — used for operator summaries. */
  async getCellStatusCounts(): Promise<CellStatusCounts> {
    if (this.trivial) {
      // No persistent cells in trivial mode — report a single perpetually-pending
      // cell so operator summaries don't surface a zero state.
      return { completed: 0, failed: 0, pending: 1, inProgress: 0 };
    }
    const ourId = runnerId();
    return withLock(this.lockPath, ourId, this.configName, () => {
      const state = loadOrInit({
        statePath: this.statePath,
        configName: this.configName,
        totalSeats: this.totalSeats,
        seedCount: this.seedCount,
        configSlotsSorted: this.configSlotsSorted,
        seatingSeed: this.seatingSeed,
      });
      return countsHelper(state);
    });
  }

  /**
   * Walks the pick priorities and returns the cell to claim plus the previous
   * `CellEntry` (so the caller can preserve `gameID` / `failureCount`) and the
   * `failureCount` value to record on the new in-progress claim.
   *
   * Returns `null` when no cell is currently pickable (caller decides whether
   * to treat that as `finished` or `wait` based on `isCycleFinished`).
   *
   * Stale steals from other runners count toward the failure budget: if a
   * steal would push the count to `maxCellFailures`, the cell is marked
   * `failed` instead and the next candidate is picked. Mutations to `state`
   * during stale-steal resolution stay in memory until the caller's final
   * `writeStateUnlocked`.
   */
  private selectClaimable(
    state: SeatingState,
    ourId: string,
    now: number,
  ): { pick: SeatingCycleCell; before: CellEntry; failureCount: number | undefined } | null {
    while (true) {
      let pick = pickCell(state, ourId, now);
      if (!pick && allCompleted(state)) {
        if (!this.resetCompletedCycles) return null;
        resetCycleInPlace(state);
        logger.warn(
          `Seating cycle "${this.configName}" completed (cycle #${state.completedCycles}); regenerated for next cycle`
        );
        pick = pickCell(state, ourId, now);
      }
      if (!pick) return null;

      const before = getCell(state, pick.rotation, pick.seedIndex);
      const isStaleSteal = before.status === 'in-progress' && before.claimedBy !== ourId;

      if (!isStaleSteal) {
        return { pick, before, failureCount: before.failureCount };
      }

      const incremented = (before.failureCount ?? 0) + 1;
      if (incremented >= this.maxCellFailures) {
        setCell(state, pick.rotation, pick.seedIndex, {
          status: 'failed',
          gameID: before.gameID,
          failureCount: incremented,
          // Preserve attribution from a prior victory-but-no-archive attempt;
          // we don't have a completion of our own to record on a stale-steal.
          completedBy: before.completedBy,
        });
        logger.warn(
          `Marking seating cell rotation=${pick.rotation} seedIndex=${pick.seedIndex} for "${this.configName}" ` +
          `as failed (silent-crash budget exhausted at ${incremented}/${this.maxCellFailures})`
        );
        continue;
      }
      return { pick, before, failureCount: incremented };
    }
  }
}
