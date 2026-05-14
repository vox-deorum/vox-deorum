/**
 * @module utils/game/seating/cycle
 *
 * Pure cycle math for the seating × seed scheduler: random permutations, the
 * fresh-cycle constructor, and the in-place reset that's used when a cycle
 * fully completes. Nothing in here touches the filesystem or any class
 * instance — every function is a pure transformation over plain data, which
 * keeps it trivial to unit-test independently of the manager.
 */

import type { SeatingCycleCell, SeatingState } from './types.js';

/** In-place-safe Fisher-Yates shuffle returning a new array. */
export function fisherYates<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Build a fresh cycle: random `basePerm`, shuffled `consumeOrder`, no cells set. */
export function buildFreshState(opts: {
  totalSeats: number;
  seedCount: number;
  configSlotsSorted: number[];
  completedCycles: number;
}): SeatingState {
  const { totalSeats, seedCount, configSlotsSorted, completedCycles } = opts;
  const basePerm = fisherYates(Array.from({ length: totalSeats }, (_, i) => i));
  const allCells: SeatingCycleCell[] = [];
  for (let rotation = 0; rotation < totalSeats; rotation++) {
    for (let seedIndex = 0; seedIndex < seedCount; seedIndex++) {
      allCells.push({ rotation, seedIndex });
    }
  }
  return {
    totalSeats,
    configSlots: [...configSlotsSorted],
    seedCount,
    basePerm,
    consumeOrder: fisherYates(allCells),
    cells: {},
    completedCycles
  };
}

/** Regenerate `basePerm` and `consumeOrder` in place; bump `completedCycles`. */
export function resetCycleInPlace(state: SeatingState): void {
  state.basePerm = fisherYates(Array.from({ length: state.totalSeats }, (_, i) => i));
  const allCells: SeatingCycleCell[] = [];
  for (let rotation = 0; rotation < state.totalSeats; rotation++) {
    for (let seedIndex = 0; seedIndex < state.seedCount; seedIndex++) {
      allCells.push({ rotation, seedIndex });
    }
  }
  state.consumeOrder = fisherYates(allCells);
  state.cells = {};
  state.completedCycles += 1;
}
