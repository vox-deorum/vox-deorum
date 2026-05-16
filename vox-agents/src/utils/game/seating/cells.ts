/**
 * @module utils/game/seating/cells
 *
 * Pure cell operations over a `SeatingState`. These helpers never touch the
 * filesystem and never reference a manager instance — they take plain state
 * plus primitives, mutate (where documented), and return results.
 *
 * The picking policy and stale-claim threshold live here so the manager file
 * stays focused on orchestration.
 */

import type { CellEntry, SeatingCycleCell, SeatingState } from './types.js';

/** How long another runner's in-progress claim can sit before we steal it. */
export const STALE_THRESHOLD_MS = 72 * 60 * 60 * 1000; // 72 hours

/** Read a cell, treating missing inner/outer keys as `pending`. */
export function getCell(state: SeatingState, rotation: number, seedIndex: number): CellEntry {
  return state.cells[String(rotation)]?.[String(seedIndex)] ?? { status: 'pending' };
}

/** Write a cell, lazily creating the inner record. */
export function setCell(
  state: SeatingState,
  rotation: number,
  seedIndex: number,
  entry: CellEntry
): void {
  const rotationKey = String(rotation);
  if (!state.cells[rotationKey]) state.cells[rotationKey] = {};
  state.cells[rotationKey][String(seedIndex)] = entry;
}

export function isCellPending(entry: CellEntry): boolean {
  return entry.status === 'pending';
}

export function isCellOwnInProgress(entry: CellEntry, ourId: string): boolean {
  return entry.status === 'in-progress' && entry.claimedBy === ourId;
}

export function isCellStaleInProgress(entry: CellEntry, now: number): boolean {
  if (entry.status !== 'in-progress' || !entry.claimedAt) return false;
  return now - Date.parse(entry.claimedAt) > STALE_THRESHOLD_MS;
}

/**
 * True iff every (rotation, seedIndex) cell is strictly `completed`.
 *
 * This is the gate for the auto-reset path in `claimNextCell`: a cycle only
 * resets when every cell finished successfully. Mixed completed-and-failed
 * states must be resolved by the operator (terminal cells are sticky).
 */
export function allCompleted(state: SeatingState): boolean {
  for (let rotation = 0; rotation < state.totalSeats; rotation++) {
    for (let seedIndex = 0; seedIndex < state.seedCount; seedIndex++) {
      if (getCell(state, rotation, seedIndex).status !== 'completed') return false;
    }
  }
  return true;
}

/**
 * True iff every (rotation, seedIndex) cell is in a terminal state
 * (`completed` or `failed`).
 *
 * Used by the auto-repetition loop to exit cleanly when the cycle has run as
 * far as it can — strict completion may never trigger if any cell is failed.
 */
export function isCycleFinished(state: SeatingState): boolean {
  for (let rotation = 0; rotation < state.totalSeats; rotation++) {
    for (let seedIndex = 0; seedIndex < state.seedCount; seedIndex++) {
      const status = getCell(state, rotation, seedIndex).status;
      if (status !== 'completed' && status !== 'failed') return false;
    }
  }
  return true;
}

export interface CellStatusCounts {
  completed: number;
  failed: number;
  pending: number;
  inProgress: number;
}

/** Aggregate cell counts by status across the current cycle. */
export function getCellStatusCounts(state: SeatingState): CellStatusCounts {
  const counts: CellStatusCounts = { completed: 0, failed: 0, pending: 0, inProgress: 0 };
  for (let rotation = 0; rotation < state.totalSeats; rotation++) {
    for (let seedIndex = 0; seedIndex < state.seedCount; seedIndex++) {
      const status = getCell(state, rotation, seedIndex).status;
      if (status === 'completed') counts.completed++;
      else if (status === 'failed') counts.failed++;
      else if (status === 'in-progress') counts.inProgress++;
      else counts.pending++;
    }
  }
  return counts;
}

/**
 * Priority-ordered cell selection used by `SeatingStateManager.claimNextCell`:
 *   1. Own in-progress (own crash recovery).
 *   2. Stale in-progress from someone else.
 *   3. Next pending cell in the shuffled `consumeOrder`.
 *
 * `completed` and `failed` cells are skipped implicitly — each priority's
 * status check excludes them. Returns null if no cell is claimable (caller
 * decides whether to reset the cycle).
 */
export function pickCell(
  state: SeatingState,
  ourId: string,
  now: number
): SeatingCycleCell | null {
  // Priority 1: own in-progress (own crash recovery).
  for (const { rotation, seedIndex } of state.consumeOrder) {
    if (isCellOwnInProgress(getCell(state, rotation, seedIndex), ourId)) {
      return { rotation, seedIndex };
    }
  }
  // Priority 2: stale in-progress from someone else.
  for (const { rotation, seedIndex } of state.consumeOrder) {
    if (isCellStaleInProgress(getCell(state, rotation, seedIndex), now)) {
      return { rotation, seedIndex };
    }
  }
  // Priority 3: next pending cell in shuffled consumeOrder.
  for (const { rotation, seedIndex } of state.consumeOrder) {
    if (isCellPending(getCell(state, rotation, seedIndex))) {
      return { rotation, seedIndex };
    }
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
export function buildSeatingMap(
  basePerm: number[],
  rotation: number,
  configSlotsSorted: number[]
): Record<string, number> {
  const N = basePerm.length;
  const seatingMap: Record<string, number> = {};
  for (let i = 0; i < configSlotsSorted.length; i++) {
    const seat = basePerm[(rotation + i) % N];
    seatingMap[String(configSlotsSorted[i])] = seat;
  }
  return seatingMap;
}
