/**
 * Tests for Oracle's bounded scheduler and graceful-stop predicate.
 */

import { describe, expect, it, vi } from 'vitest';
import { runOracleTasks } from '../../../src/oracle/run-control.js';
import { deferred } from '../../helpers/deferred.js';

/** Waits until an assertion succeeds while scheduler microtasks are progressing. */
async function waitFor(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion);
}

describe('oracle run control', () => {
  it('keeps source order while dynamically filling bounded concurrency slots', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const third = deferred<string>();
    const starts: number[] = [];

    const run = runOracleTasks([
      () => { starts.push(0); return first.promise; },
      () => { starts.push(1); return second.promise; },
      () => { starts.push(2); return third.promise; },
    ], 2);

    await waitFor(() => expect(starts).toEqual([0, 1]));
    second.resolve('second');
    await waitFor(() => expect(starts).toEqual([0, 1, 2]));
    third.resolve('third');
    first.resolve('first');

    await expect(run).resolves.toEqual({ results: ['first', 'second', 'third'], stopped: false });
  });

  it('drains admitted tasks and resumes admission when the stop is cancelled before the final task settles', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const third = deferred<string>();
    const fourth = deferred<string>();
    const starts: number[] = [];
    const stop = { value: false };
    const run = runOracleTasks([
      () => { starts.push(0); return first.promise; },
      () => { starts.push(1); return second.promise; },
      () => { starts.push(2); return third.promise; },
      () => { starts.push(3); return fourth.promise; },
    ], 2, () => stop.value);

    await waitFor(() => expect(starts).toEqual([0, 1]));
    stop.value = true;
    first.resolve('first');
    await waitFor(() => expect(starts).toEqual([0, 1]));
    stop.value = false;
    second.resolve('second');
    await waitFor(() => expect(starts).toEqual([0, 1, 2, 3]));
    third.resolve('third');
    fourth.resolve('fourth');

    await expect(run).resolves.toEqual({ results: ['first', 'second', 'third', 'fourth'], stopped: false });
  });

  it('reports a stop and returns only the drained tasks when queued work is withheld', async () => {
    const first = deferred<string>();
    const withheld = vi.fn(async () => 'withheld');
    const stop = { value: false };
    const run = runOracleTasks([() => first.promise, withheld], 1, () => stop.value);

    await waitFor(() => expect(stop.value).toBe(false));
    stop.value = true;
    first.resolve('first');

    await expect(run).resolves.toEqual({ results: ['first'], stopped: true });
    expect(withheld).not.toHaveBeenCalled();
  });

  it('commits an initial stop without admitting work', async () => {
    const task = vi.fn(async () => 'unexpected');

    await expect(runOracleTasks([task], 1, () => true)).resolves.toEqual({ results: [], stopped: true });

    expect(task).not.toHaveBeenCalled();
  });

  it('completes normally when a stop arrives after every task was already admitted', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const stop = { value: false };
    const run = runOracleTasks([
      () => first.promise,
      () => second.promise,
    ], 2, () => stop.value);

    await Promise.resolve();
    stop.value = true;
    first.resolve('first');
    second.resolve('second');

    // Nothing was withheld, so callers must publish this run's results rather than discard them.
    await expect(run).resolves.toEqual({ results: ['first', 'second'], stopped: false });
  });

  it('rejects invalid concurrency values', async () => {
    await expect(runOracleTasks([], 0)).rejects.toThrow('Expected `concurrency` to be a number from 1 and up');
  });
});
