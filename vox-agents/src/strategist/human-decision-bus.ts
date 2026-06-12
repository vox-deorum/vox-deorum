/**
 * @module strategist/human-decision-bus
 *
 * Per-session bridge between the in-game human-control panel and the waiting
 * {@link HumanStrategist}. One instance lives on each {@link StrategistSession}
 * (not a module-level global) so a single vox-agents process could in principle
 * run multiple games, each with its own isolated bus.
 *
 * Mechanics: the strategist awaits {@link HumanDecisionBus.request} for its
 * playerID; the session's `HumanDecision` notification handler calls
 * {@link HumanDecisionBus.resolve} with the human's submission. Shutdown, abort,
 * and crash-recovery relaunches call {@link HumanDecisionBus.cancel} /
 * {@link HumanDecisionBus.cancelAll} so a pending wait rejects cleanly rather
 * than hanging — VoxPlayer's per-turn error handling catches the rejection and
 * still resumes the game.
 */

import { createLogger } from "../utils/logger.js";

const logger = createLogger("HumanDecisionBus");

/**
 * A human strategist's submitted decision, as carried by the `HumanDecision`
 * notification's `data` payload. Mirrors the deliberately permissive mcp-server
 * `HumanDecision` event schema: `Rationale` and `DeliberationMs` are guaranteed,
 * and every decision field is optional so the panel's payload can grow over
 * later stages without breaking the bus. Human control runs in Flavor mode only.
 */
export interface HumanDecisionSubmission {
  /** The human strategist's player ID (routing field; mirrors the notification). */
  PlayerID?: number;
  /** Free-text rationale covering the whole turn's decision (replicated across action tools). */
  Rationale: string;
  /** Source turn the decision was made on. */
  Turn?: number;
  /** Milliseconds from first opening the decision dialog to submission, measured in-game. */
  DeliberationMs: number;
  /** Explicit keep-status-quo: maintain the current direction (recorded as a real decision). */
  StatusQuo?: boolean;
  /** Chosen grand strategy name (Flavor mode). */
  GrandStrategy?: string;
  /** Custom flavor values by flavor name. */
  Flavors?: Record<string, number>;
  /** Chosen next research technology name. */
  Technology?: string;
  /** Chosen next policy (or policy-branch) name. */
  Policy?: string;
  /** Persona value overrides by persona key (forward-looking; panel section lands later). */
  Persona?: Record<string, number>;
  /** Diplomatic relationship modifiers (forward-looking; panel section lands later). */
  Relationships?: Array<{ TargetID: number; Public?: number; Private?: number }>;
  /** Forward-compatible: any additional panel fields ride along untouched. */
  [key: string]: unknown;
}

/** A single in-flight decision request, keyed by playerID in the bus. */
interface PendingDecision {
  resolve: (submission: HumanDecisionSubmission) => void;
  reject: (reason: Error) => void;
  /** Wall-clock timestamp when the request was made (spec §4 — deliberation time). */
  requestedAt: number;
}

/**
 * A map from playerID to a pending decision promise. Isolated per session and
 * keyed by playerID so mixed seats — and, in principle, concurrent games — stay
 * independent.
 */
export class HumanDecisionBus {
  private readonly pending = new Map<number, PendingDecision>();

  /**
   * Begin waiting for a human's decision for `playerID`, returning a promise
   * that resolves with their submission (or rejects if the request is
   * cancelled). Any still-pending request for the same player is cancelled
   * first so a stale wait — e.g. one a crash-recovery relaunch left behind —
   * cannot shadow the fresh one.
   */
  request(playerID: number): Promise<HumanDecisionSubmission> {
    if (this.pending.has(playerID)) {
      logger.warn(`Superseding a still-pending decision request for player ${playerID}`);
      this.cancel(playerID, new Error("Superseded by a new human decision request"));
    }
    return new Promise<HumanDecisionSubmission>((resolve, reject) => {
      this.pending.set(playerID, { resolve, reject, requestedAt: Date.now() });
      logger.info(`Awaiting human decision for player ${playerID}`);
    });
  }

  /**
   * Resolve the pending request for `playerID` with the human's submission.
   * Returns false (and is a no-op) when no request is pending — e.g. a decision
   * arrives after a crash cancelled the wait and before the re-presented request
   * lands.
   */
  resolve(playerID: number, submission: HumanDecisionSubmission): boolean {
    const entry = this.pending.get(playerID);
    if (!entry) return false;
    this.pending.delete(playerID);
    logger.info(`Resolved human decision for player ${playerID} after ${Date.now() - entry.requestedAt}ms`);
    entry.resolve(submission);
    return true;
  }

  /**
   * Cancel the pending request for `playerID`, rejecting its promise. Clearing
   * the entry is what lets a subsequent {@link request} take over without being
   * shadowed by the old wait (crash recovery, spec §6).
   */
  cancel(playerID: number, reason?: Error): boolean {
    const entry = this.pending.get(playerID);
    if (!entry) return false;
    this.pending.delete(playerID);
    entry.reject(reason ?? new Error("Human decision request cancelled"));
    return true;
  }

  /** Cancel every pending request (shutdown / abort / game-context switch). */
  cancelAll(reason?: Error): void {
    for (const playerID of [...this.pending.keys()]) {
      this.cancel(playerID, reason);
    }
  }

  /** Whether a decision request is currently pending for `playerID`. */
  isPending(playerID: number): boolean {
    return this.pending.has(playerID);
  }
}
