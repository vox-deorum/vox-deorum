/**
 * @module utils/game/seating/io
 *
 * File-system + lock primitives for the seating cycle state file.
 *
 * The lock is implemented via exclusive-create on a sibling `.lock` file with
 * stale-lock recovery so a dead holder can't strand the cycle. State reads and
 * writes are atomic at the file-system level (tmp + rename); reads tolerate
 * missing/corrupt files by returning null.
 *
 * `loadOrInit` is the one helper here that's not purely I/O: it composes a read
 * with shape validation and falls back to a fresh state built by `cycle.ts` when
 * the on-disk file is missing, stale (config drifted), or malformed.
 */

import fs from 'fs';
import path from 'path';
import { setTimeout } from 'node:timers/promises';
import { createLogger } from '../../logger.js';
import { arraysEqual, buildFreshState } from './cycle.js';
import type { SeatingState } from './types.js';

const logger = createLogger('SeatingIO');

/** How long a `.lock` file can exist before we treat it as orphaned. */
const LOCK_STALE_THRESHOLD_MS = 60 * 1000; // 60 seconds — well above any normal RMW

/** Lock acquisition retry tuning (exponential backoff capped at LOCK_MAX_DELAY_MS). */
const LOCK_INITIAL_DELAY_MS = 50;
const LOCK_MAX_DELAY_MS = 1000;
const LOCK_MAX_ATTEMPTS = 20;

/**
 * Acquire a file lock via exclusive create. If the lock file exists but is
 * older than {@link LOCK_STALE_THRESHOLD_MS}, assume the previous holder died
 * and steal it. Otherwise retry with exponential backoff up to {@link
 * LOCK_MAX_ATTEMPTS}.
 */
export async function acquireLock(lockPath: string, runnerId: string): Promise<void> {
  let attempt = 0;
  let delayMs = LOCK_INITIAL_DELAY_MS;

  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, runnerId);
      fs.closeSync(fd);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;

      // Stale-lock recovery: if the existing lock is older than threshold,
      // its holder probably died without cleanup — remove and retry.
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_THRESHOLD_MS) {
          logger.warn(`Removing stale lock file ${lockPath}`);
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // Lock disappeared between EEXIST and stat — retry the open immediately.
        continue;
      }

      attempt++;
      if (attempt >= LOCK_MAX_ATTEMPTS) {
        throw new Error(
          `Failed to acquire seating-state lock after ${attempt} attempts: ${lockPath}`
        );
      }
      await setTimeout(delayMs);
      delayMs = Math.min(delayMs * 2, LOCK_MAX_DELAY_MS);
    }
  }
}

/** Best-effort lock release; tolerates the file already being gone. */
export function releaseLock(lockPath: string, configName: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn(`Failed to release lock for ${configName}: ${(err as Error).message}`);
    }
  }
}

/** Run `fn` while holding the file lock. The lock is always released. */
export async function withLock<T>(
  lockPath: string,
  runnerId: string,
  configName: string,
  fn: () => T | Promise<T>
): Promise<T> {
  await acquireLock(lockPath, runnerId);
  try {
    return await fn();
  } finally {
    releaseLock(lockPath, configName);
  }
}

/**
 * Read state from disk, or return null on missing/corrupt files. A corrupt
 * file is logged and treated as missing so callers can recover gracefully.
 */
export function readStateUnlocked(statePath: string): SeatingState | null {
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    return JSON.parse(raw) as SeatingState;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    logger.warn(
      `Failed to read seating state ${statePath}: ${(err as Error).message}; treating as fresh`
    );
    return null;
  }
}

/** Atomic write via temp file + rename — readers never see a torn JSON. */
export function writeStateUnlocked(statePath: string, state: SeatingState): void {
  const tmp = `${statePath}.tmp`;
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, statePath);
}

/**
 * Load state and validate it matches the expected `(totalSeats, configSlots,
 * seedCount, seatingSeed)` shape. If the shape has drifted (config edited
 * between runs) or the file is malformed, regenerate a fresh cycle while
 * preserving `completedCycles` (so cumulative cycle counts remain meaningful).
 *
 * `seatingSeed` mismatch is treated as drift: the persisted cycle would no
 * longer reflect the configured seed.
 */
export function loadOrInit(opts: {
  statePath: string;
  configName: string;
  totalSeats: number;
  seedCount: number;
  configSlotsSorted: number[];
  seatingSeed: number;
}): SeatingState {
  const { statePath, configName, totalSeats, seedCount, configSlotsSorted, seatingSeed } = opts;
  const existing = readStateUnlocked(statePath);

  if (
    existing &&
    existing.totalSeats === totalSeats &&
    existing.seedCount === seedCount &&
    existing.seatingSeed === seatingSeed &&
    Array.isArray(existing.configSlots) &&
    arraysEqual(existing.configSlots, configSlotsSorted)
  ) {
    // Defensive check: the schema shape may match but the contents could be
    // truncated (e.g., from an earlier crash mid-write before atomic rename
    // existed). Fall through to a fresh build if anything looks off.
    if (
      Array.isArray(existing.basePerm) &&
      existing.basePerm.length === totalSeats &&
      Array.isArray(existing.consumeOrder) &&
      existing.consumeOrder.length === totalSeats * seedCount &&
      typeof existing.completedCycles === 'number'
    ) {
      if (!existing.cells || typeof existing.cells !== 'object') existing.cells = {};
      return existing;
    }
    logger.warn(`Seating state for "${configName}" is malformed; regenerating`);
  } else if (existing) {
    logger.warn(
      `Seating state for "${configName}" is stale ` +
      `(totalSeats=${existing.totalSeats}/${totalSeats}, ` +
      `seedCount=${existing.seedCount}/${seedCount}, ` +
      `configSlots=${JSON.stringify(existing.configSlots)}/${JSON.stringify(configSlotsSorted)}, ` +
      `seatingSeed=${existing.seatingSeed}/${seatingSeed}); ` +
      `regenerating`
    );
  }

  return buildFreshState({
    totalSeats,
    seedCount,
    configSlotsSorted,
    completedCycles: existing?.completedCycles ?? 0,
    seatingSeed,
  });
}
