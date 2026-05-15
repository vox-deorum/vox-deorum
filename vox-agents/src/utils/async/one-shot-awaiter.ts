/**
 * @module utils/async/one-shot-awaiter
 *
 * Generic single-event awaiter with timeout fallback.
 *
 * Pattern: code path A stashes an awaiter; code path B (an external callback,
 * notification handler, etc.) eventually calls `resolve(value)`; code path C
 * blocks on `wait(timeoutMs, onTimeout)` until either the resolve fires or the
 * timeout elapses.
 *
 * The awaiter is one-shot and idempotent — once settled (by resolve OR
 * timeout) further `resolve()` calls are no-ops, and additional `wait()` calls
 * return the settled value immediately. Any predicate or filtering (e.g. "only
 * resolve when this notification's id matches") belongs at the call site, not
 * inside this class.
 */

import { setTimeout } from 'node:timers/promises';

export class OneShotAwaiter<T> {
  private settled = false;
  private resolveFn!: (value: T) => void;
  private readonly promise: Promise<T>;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolveFn = resolve;
    });
  }

  /**
   * Settle the awaiter with `value`. Idempotent — subsequent calls (including
   * calls after a `wait()` has timed out) are no-ops.
   */
  resolve(value: T): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveFn(value);
  }

  /**
   * Wait up to `timeoutMs` for the awaiter to settle. On timeout the awaiter
   * is settled with `onTimeout`, so any later `resolve()` is a no-op and a
   * second `wait()` returns the same `onTimeout` value.
   */
  async wait(timeoutMs: number, onTimeout: T): Promise<T> {
    return Promise.race([
      this.promise,
      setTimeout(timeoutMs).then(() => {
        if (!this.settled) {
          this.settled = true;
          this.resolveFn(onTimeout);
        }
        return onTimeout;
      }),
    ]);
  }
}
