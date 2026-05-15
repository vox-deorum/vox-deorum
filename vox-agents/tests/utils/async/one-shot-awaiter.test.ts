/**
 * Unit tests for {@link OneShotAwaiter}, the generic single-event awaiter used
 * across the codebase for "wait for one external notification, with a timeout
 * fallback" flows (notably the strategist's GameArchived gate). No mocks
 * needed — the class has no external dependencies beyond
 * `node:timers/promises.setTimeout`.
 */

import { describe, expect, it } from 'vitest';
import { OneShotAwaiter } from '../../../src/utils/async/one-shot-awaiter.js';

describe('OneShotAwaiter', () => {
  it('resolves with the supplied value', async () => {
    const awaiter = new OneShotAwaiter<boolean>();
    awaiter.resolve(true);
    expect(await awaiter.wait(1000, false)).toBe(true);
  });

  it('resolves with falsy values too', async () => {
    const awaiter = new OneShotAwaiter<boolean>();
    awaiter.resolve(false);
    // The awaiter must distinguish "resolved with false" from "timed out" —
    // both surface as false here, but the second wait should also be immediate.
    const start = Date.now();
    expect(await awaiter.wait(5000, true)).toBe(false);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('returns the onTimeout value when never resolved', async () => {
    const awaiter = new OneShotAwaiter<string>();
    const start = Date.now();
    const result = await awaiter.wait(150, 'fallback');
    const elapsed = Date.now() - start;
    expect(result).toBe('fallback');
    expect(elapsed).toBeGreaterThanOrEqual(140);
  });

  it('is idempotent — a second resolve() does not change the outcome', async () => {
    const awaiter = new OneShotAwaiter<boolean>();
    awaiter.resolve(true);
    awaiter.resolve(false);
    expect(await awaiter.wait(1000, false)).toBe(true);
  });

  it('is idempotent against post-timeout resolve()', async () => {
    const awaiter = new OneShotAwaiter<boolean>();
    const result = await awaiter.wait(80, false);
    expect(result).toBe(false);
    awaiter.resolve(true);
    // A subsequent wait should still see the timed-out value.
    expect(await awaiter.wait(80, false)).toBe(false);
  });

  it('returns the resolved value without delay when wait() is called after resolve()', async () => {
    const awaiter = new OneShotAwaiter<number>();
    awaiter.resolve(42);
    const start = Date.now();
    const result = await awaiter.wait(5000, -1);
    const elapsed = Date.now() - start;
    expect(result).toBe(42);
    expect(elapsed).toBeLessThan(50);
  });

  it('supports non-primitive payloads', async () => {
    type Payload = { ok: boolean; gameId: string };
    const awaiter = new OneShotAwaiter<Payload>();
    const expected: Payload = { ok: true, gameId: 'game-A' };
    awaiter.resolve(expected);
    expect(await awaiter.wait(1000, { ok: false, gameId: '' })).toEqual(expected);
  });
});
