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
 * cell only ever completes with one gameID (the one that was successfully
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
   * Civ V gameID associated with this cell:
   *   - `in-progress`: the current attempt's gameID (set via `attachGameID` on GameSwitched).
   *   - `completed`:   the gameID whose archive succeeded.
   *   - `failed`/`pending`: the last attempted gameID (for forensics).
   */
  gameID?: string;
  /**
   * Total crashes / archive-misses observed on this cell since the cycle began.
   * Reaching `maxCellFailures` flips the cell to terminal `failed`.
   */
  failureCount?: number;
  /** ISO timestamp of the successful archive notification. Set together with `status='completed'`. */
  archivedAt?: string;
  /**
   * `${hostname}#${pid}` of the runner that completed the game on this cell.
   * Set whenever the underlying game reached `PlayerVictory` (regardless of
   * archive outcome — both the `completed` branch and the archive-but-missing
   * failure branch record it). Lets operators attribute games across machines
   * in a shared cycle, and preserves attribution when an otherwise-successful
   * game gets retried due to a missed archive notification.
   */
  completedBy?: string;
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
  /**
   * Seed used to derive `basePerm` and `consumeOrder` deterministically.
   * On every cycle reset the effective seed is `seatingSeed + completedCycles`,
   * so cycles vary while remaining reproducible from the original config seed.
   */
  seatingSeed: number;
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
   * Whether a strictly completed cycle should be regenerated on the next
   * claim. Defaults to true so explicit numeric repetitions can continue into
   * a fresh cycle; auto-repetition disables this to stop after one cycle.
   */
  resetCompletedCycles?: boolean;
  /**
   * Whether the configured slots should be randomized across seats.
   *
   * - `false` / `undefined` AND `seedSets.length === 1`: cycle is trivial —
   *   the manager returns an in-memory identity claim and skips all filesystem
   *   persistence (no `*.seating.json`, no lock).
   * - `true`: alias for `0` — engages the cycle with seed `0`.
   * - `<uint32>`: engages the cycle with that seed. Both `basePerm` and
   *   `consumeOrder` are derived from `seedrandom(seed + completedCycles)`,
   *   so the cycle is reproducible across machines and advances across
   *   cycle resets.
   *
   * Defaults to `false`.
   */
  randomizeSeating?: boolean | number;
}
