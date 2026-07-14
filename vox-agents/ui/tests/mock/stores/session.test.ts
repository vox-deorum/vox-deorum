import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import {
  fetchSessionStatus,
  pauseSession,
  sessionStatus,
  startSessionPolling
} from '@/stores/session';
import type { SessionStatusResponse, StrategistSessionConfig } from '@/utils/types';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

/** Create a promise whose settlement is controlled by the test. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** Build a session response in the requested active state. */
function createStatus(active: boolean): SessionStatusResponse {
  if (!active) return { active: false };
  const config: StrategistSessionConfig = {
    name: 'test',
    type: 'strategist',
    autoPlay: true,
    gameMode: 'start',
    repetition: 1,
    llmPlayers: {}
  };
  return {
    active: true,
    session: {
      id: 'session-1',
      type: 'strategist',
      state: 'running',
      config,
      startTime: new Date()
    }
  };
}

afterEach(() => {
  sessionStatus.value = null;
});

beforeEach(() => {
  vi.useFakeTimers();
});

describe('session polling', () => {
  it('issues a new status read after a mutation instead of reusing an older poll', async () => {
    const beforePause = createDeferred<SessionStatusResponse>();
    const afterPause = createStatus(true);
    if (afterPause.session) afterPause.session.paused = true;
    const request = vi.spyOn(api, 'getSessionStatus')
      .mockReturnValueOnce(beforePause.promise)
      .mockResolvedValueOnce(afterPause);
    vi.spyOn(api, 'pauseSession').mockResolvedValue({
      success: true,
      message: 'Paused',
      paused: true
    });

    const earlierRead = fetchSessionStatus();
    const action = pauseSession();
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(1);

    beforePause.resolve(createStatus(true));
    await earlierRead;
    await action;

    expect(request).toHaveBeenCalledTimes(2);
    expect(sessionStatus.value?.session?.paused).toBe(true);
  });

  it('does not start an interval when the initial request resolves after release', async () => {
    const deferred = createDeferred<SessionStatusResponse>();
    const request = vi.spyOn(api, 'getSessionStatus').mockReturnValue(deferred.promise);

    const release = startSessionPolling();
    release();
    deferred.resolve(createStatus(true));
    await deferred.promise;
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('deduplicates overlapping ticks and stops after the inactive response', async () => {
    const initial = createDeferred<SessionStatusResponse>();
    const poll = createDeferred<SessionStatusResponse>();
    const request = vi.spyOn(api, 'getSessionStatus')
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(poll.promise);

    const release = startSessionPolling();
    initial.resolve(createStatus(true));
    await fetchSessionStatus();

    await vi.advanceTimersByTimeAsync(8_000);
    expect(request).toHaveBeenCalledTimes(2);

    poll.resolve(createStatus(false));
    await poll.promise;
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(8_000);

    expect(request).toHaveBeenCalledTimes(2);
    expect(sessionStatus.value).toEqual({ active: false });
    release();
  });
});
