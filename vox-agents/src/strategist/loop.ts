/**
 * @module strategist/loop
 *
 * Shared repetition loop for `StrategistSession`. Owns the `SeatingStateManager`
 * for the whole loop (so cycle state writes are serialized) and reuses it
 * across iterations — each iteration claims the next cell, hands it to a
 * fresh session, then shuts the session down before the next claim.
 *
 * `claimNextCell` returns `null` when the cycle is finished (every cell
 * terminal, can't auto-reset); the loop exits cleanly on that signal. Wait
 * cases (peers still mid-game) are handled inside `claimNextCell` itself, so
 * the loop body stays trivial.
 *
 * Used by both the console entry point and the web `/api/session/start` route.
 */

import { processManager } from '../infra/process-manager.js';
import { SeatingStateManager } from '../utils/game/seating/state.js';
import { createLogger } from '../utils/logger.js';
import type { StrategistSessionConfig } from '../types/config.js';
import { buildSeatingManagerOptions } from './seating-options.js';
import { StrategistSession } from './strategist-session.js';

const logger = createLogger('strategist-loop');

export interface StrategistLoopOptions {
  config: StrategistSessionConfig;
  /** Caps iterations; pass `Number.POSITIVE_INFINITY` for auto-repetition. */
  maxRepetitions: number;
  /** Stop when the current seating x seed cycle is complete instead of rolling over. */
  stopAfterCurrentCycle?: boolean;
  /**
   * Optional hook so the embedding layer (console or web) can track the
   * currently-active session — e.g. so SIGINT or `/api/session/stop` can call
   * `shutdown()` on the in-flight session. Receives `null` between iterations.
   */
  onSession?: (session: StrategistSession | null) => void;
  /**
   * Optional predicate consulted between iterations to allow embedders to
   * stop the loop without killing the process — e.g. the console's Ctrl+A
   * "stop after current session" flag. The loop also stops unconditionally
   * when `processManager.isShuttingDown` flips.
   */
  shouldStop?: () => boolean;
}

export async function runStrategistLoop(opts: StrategistLoopOptions): Promise<void> {
  const seatingManager = new SeatingStateManager({
    ...buildSeatingManagerOptions(opts.config),
    resetCompletedCycles: !opts.stopAfterCurrentCycle,
  });

  for (let i = 0; i < opts.maxRepetitions; i++) {
    if (processManager.isShuttingDown || opts.shouldStop?.()) break;

    const claim = await seatingManager.claimNextCell();
    if (!claim) {
      logger.info(`Seating × seed cycle finished after ${i} session(s); exiting loop`);
      break;
    }

    const session = new StrategistSession(opts.config, seatingManager, claim);
    opts.onSession?.(session);
    try {
      await session.start();
      logger.info(`Session ${i} completed successfully`);
    } finally {
      await session.shutdown();
      opts.onSession?.(null);
    }

    if (processManager.isShuttingDown || opts.shouldStop?.()) break;
    // Subsequent iterations always start a fresh game (the first iteration may
    // have been `load`/`wait`); mirrors the inline-loop behavior in console.ts.
    opts.config.gameMode = 'start';
  }
}
