/**
 * Tests for Oracle's bounded scheduler and graceful-stop predicate.
 */

import { describe, expect, it, vi } from 'vitest';
import { runOracleTaskChains, runOracleTasks } from '../../../src/oracle/run-control.js';
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

describe('oracle chain scheduler', () => {
  it('should run a chain continuation before untouched episodes', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const waitingEpisode = deferred<string>();
    const starts: number[] = [];
    const run = runOracleTaskChains([
      [
        { index: 0, run: () => { starts.push(0); return first.promise; } },
        { index: 2, run: () => { starts.push(2); return second.promise; } },
      ],
      [{ index: 1, run: () => { starts.push(1); return waitingEpisode.promise; } }],
    ], 1);

    await waitFor(() => expect(starts).toEqual([0]));
    first.resolve('first');
    await waitFor(() => expect(starts).toEqual([0, 2]));
    second.resolve('second');
    await waitFor(() => expect(starts).toEqual([0, 2, 1]));
    waitingEpisode.resolve('episode');

    await expect(run).resolves.toEqual({
      results: [
        { index: 0, result: 'first' },
        { index: 2, result: 'second' },
        { index: 1, result: 'episode' },
      ],
      stopped: false,
    });
  });

  it('should admit episodes in FIFO order and keep indexes on out-of-order completions', async () => {
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const starts: string[] = [];
    const chains = gates.map((gate, index) => [{
      index,
      run: () => {
        starts.push(`start-${index}`);
        return gate.promise;
      },
    }]);

    const run = runOracleTaskChains(chains, 2);
    await waitFor(() => expect(starts).toEqual(['start-0', 'start-1']));
    gates[1].resolve('one');
    await waitFor(() => expect(starts).toEqual(['start-0', 'start-1', 'start-2']));
    gates[2].resolve('two');
    gates[0].resolve('zero');

    await expect(run).resolves.toEqual({
      results: [
        { index: 1, result: 'one' },
        { index: 2, result: 'two' },
        { index: 0, result: 'zero' },
      ],
      stopped: false,
    });
  });

  it('should run at most one factory per chain within the global cap', async () => {
    const gates = Array.from({ length: 4 }, () => deferred<string>());
    const starts: string[] = [];
    let active = 0;
    let maxActive = 0;

    /** Wraps a deferred sample with start tracking and active work accounting. */
    const makeTask = (label: string, index: number) => ({
      index,
      run: async (): Promise<string> => {
        starts.push(label);
        active += 1;
        maxActive = Math.max(maxActive, active);
        const value = await gates[index].promise;
        active -= 1;
        return value;
      },
    });

    const run = runOracleTaskChains([
      [makeTask('a0', 0), makeTask('a2', 2)],
      [makeTask('b1', 1), makeTask('b3', 3)],
    ], 2);

    await waitFor(() => expect(starts).toEqual(['a0', 'b1']));
    gates[0].resolve('a0');
    await waitFor(() => expect(starts).toEqual(['a0', 'b1', 'a2']));
    expect(starts).not.toContain('b3');

    gates[1].resolve('b1');
    await waitFor(() => expect(starts).toEqual(['a0', 'b1', 'a2', 'b3']));
    gates[2].resolve('a2');
    gates[3].resolve('b3');

    await expect(run).resolves.toEqual({
      results: [
        { index: 0, result: 'a0' },
        { index: 1, result: 'b1' },
        { index: 2, result: 'a2' },
        { index: 3, result: 'b3' },
      ],
      stopped: false,
    });
    expect(maxActive).toBe(2);
  });

  it('should advance a chain after a sample settles with a failed result', async () => {
    const next = deferred<{ error?: string }>();
    const starts: number[] = [];
    const run = runOracleTaskChains([[
      { index: 0, run: async (): Promise<{ error?: string }> => { starts.push(0); return { error: 'sample failed' }; } },
      { index: 1, run: () => { starts.push(1); return next.promise; } },
    ]], 1);

    await waitFor(() => expect(starts).toEqual([0, 1]));
    next.resolve({});

    await expect(run).resolves.toEqual({
      results: [
        { index: 0, result: { error: 'sample failed' } },
        { index: 1, result: {} },
      ],
      stopped: false,
    });
  });

  it('should complete empty chains without work even under a stop and reject invalid concurrency', async () => {
    await expect(runOracleTaskChains([], 2)).resolves.toEqual({ results: [], stopped: false });
    await expect(runOracleTaskChains([[]], 2, () => true)).resolves.toEqual({ results: [], stopped: false });
    await expect(runOracleTaskChains([], 0)).rejects.toThrow('Expected `concurrency` to be a number from 1 and up');
    await expect(runOracleTaskChains([], 1.5)).rejects.toThrow('Expected `concurrency` to be a number from 1 and up');
  });

  it('should withhold a continuation when a stop arrives with no untouched episodes', async () => {
    const first = deferred<string>();
    const firstRun = vi.fn(() => first.promise);
    const continuation = vi.fn(async () => 'second');
    const stop = { value: false };
    const run = runOracleTaskChains([[
      { index: 0, run: firstRun },
      { index: 1, run: continuation },
    ]], 1, () => stop.value);

    await waitFor(() => expect(firstRun).toHaveBeenCalledTimes(1));
    stop.value = true;
    first.resolve('first');

    await expect(run).resolves.toEqual({ results: [{ index: 0, result: 'first' }], stopped: true });
    expect(continuation).not.toHaveBeenCalled();
  });

  it('should admit a blocked continuation when a stop is cancelled before active work drains', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const continuation = deferred<string>();
    const starts: string[] = [];
    const stop = { value: false };
    const run = runOracleTaskChains([
      [
        { index: 0, run: () => { starts.push('a0'); return first.promise; } },
        { index: 2, run: () => { starts.push('a2'); return continuation.promise; } },
      ],
      [{ index: 1, run: () => { starts.push('b1'); return second.promise; } }],
    ], 2, () => stop.value);

    await waitFor(() => expect(starts).toEqual(['a0', 'b1']));
    stop.value = true;
    first.resolve('a0');
    await waitFor(() => expect(starts).toEqual(['a0', 'b1']));
    stop.value = false;
    second.resolve('b1');
    await waitFor(() => expect(starts).toEqual(['a0', 'b1', 'a2']));
    continuation.resolve('a2');

    await expect(run).resolves.toEqual({
      results: [
        { index: 0, result: 'a0' },
        { index: 1, result: 'b1' },
        { index: 2, result: 'a2' },
      ],
      stopped: false,
    });
  });

  it('should reject and stop admitting new chains when a task throws', async () => {
    const later = vi.fn(async () => 'later');
    const run = runOracleTaskChains([
      [{ index: 0, run: async () => { throw new Error('boom'); } }],
      [{ index: 1, run: later }],
    ], 1);

    await expect(run).rejects.toThrow('boom');
    expect(later).not.toHaveBeenCalled();
  });
});
