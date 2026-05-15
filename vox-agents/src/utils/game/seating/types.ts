/**
 * @module utils/game/seating/types
 *
 * Shared types for the persistent seating × seed cycle scheduler.
 * See {@link ./state.ts} for the manager that operates on these.
 */

import type { RandomSeedsConfig } from '../../../types/config.js';

export type CellStatus = 'pending' | 'in-progress' | 'completed' | 'failed';

/**
 * Persistent record of a single (rotation, seedIndex) cell.
 *
 * The optional fields below carry per-cell history that lets operators trace
 * archive mismatches and lets the manager enforce a bounded retry budget. A
 * cell only ever completes with one gameId (the one that was successfully
 * archived); the field is overwritten on each new GameSwitched so re-claims
 * and crash-recoveries simply replace it.
 */
export interface CellEntry {
  status: CellStatus;
  /** ISO timestamp when the cell was claimed. Present only for `in-progress`. */
  claimedAt?: string;
  /** `${hostname}#${pid}` of the claiming runner. Present only for `in-progress`. */
  claimedBy?: string;
  /**
   * Civ V gameId associated with this cell:
   *   - `in-progress`: the current attempt's gameId (set via `attachGameId` on GameSwitched).
   *   - `completed`:   the gameId whose archive succeeded.
   *   - `failed`/`pending`: the last attempted gameId (for forensics).
   */
  gameId?: string;
  /**
   * Total crashes / archive-misses observed on this cell since the cycle began.
   * Reaching `maxCellFailures` flips the cell to terminal `failed`.
   */
  failureCount?: number;
  /** ISO timestamp of the successful archive notification. Set together with `status='completed'`. */
  archivedAt?: string;
}

/** Coordinate of one scheduled seating rotation and seed set pairing. */
export interface SeatingCycleCell {
  rotation: number;
  seedIndex: number;
}

/** On-disk schema for a config's seating cycle state. */
export interface SeatingState {
  /** Total number of seats. */
  totalSeats: number;
  /** Sorted ascending. The configured `llmPlayers` keys. */
  configSlots: number[];
  /** Total number of seeds. */
  seedCount: number;
  /** Random permutation of `[0..totalSeats-1]`. */
  basePerm: number[];
  /** Shuffled order of all cycle cells; consumed front-to-back. */
  consumeOrder: SeatingCycleCell[];
  /** Two-level map: `cells[String(rotation)][String(seedIndex)] = entry`. Missing keys = pending. */
  cells: Record<string, Record<string, CellEntry>>;
  /** How many cycles have fully completed (each = N*M successful games). */
  completedCycles: number;
}

/** Result of a successful claim — pass to `releaseCell` when the game ends. */
export interface SeatingClaim {
  rotation: number;
  seedIndex: number;
  /** Mapping configSlot (string) → actual game player ID for this game. */
  seatingMap: Record<string, number>;
  /** Seed set for this game; undefined if no fixed seeds were configured for this index. */
  seeds?: RandomSeedsConfig;
  /** ISO timestamp recorded on the cell at claim time; used to detect drift on release. */
  claimedAt: string;
}

/** Constructor parameters for `SeatingStateManager`. */
export interface SeatingStateManagerOptions {
  configName: string;
  /** The `Object.keys(llmPlayers).map(Number)` set — order-insensitive. */
  configSlots: number[];
  /** N — total game player slots (typically `max(configSlot) + 1`). */
  totalSeats: number;
  /** M — number of seed sets to cycle through (always equal to `seedSets.length`). */
  seedCount: number;
  /**
   * The seed sets to associate with each seedIndex. `undefined` entries mean
   * "let Civ choose" for that index. Length must equal `seedCount`.
   */
  seedSets: Array<RandomSeedsConfig | undefined>;
  /**
   * Total crashes / archive-misses tolerated per cell before it becomes
   * terminal `failed` (and is excluded from `pickCell`). Defaults to 5.
   */
  maxCellFailures?: number;
  /**
   * Whether the configured slots should be randomized across seats.
   *
   * When `false` AND `seedSets.length === 1`, the cycle is trivial — there's
   * nothing to schedule. The manager returns an in-memory identity claim and
   * skips all filesystem persistence (no `*.seating.json`, no lock). When
   * `true`, or when `seedSets.length > 1`, the persistent cycle kicks in as
   * usual. Defaults to `false`.
   */
  randomizeSeating?: boolean;
}
