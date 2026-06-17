/**
 * Unit tests for the event-pipe service.
 *
 * `event-pipe.ts` broadcasts game events over a `node-ipc` named pipe. These
 * tests mock `node-ipc` entirely (no real pipe is opened) and toggle
 * `config.eventpipe.enabled` by mutating the imported singleton config object.
 * A fresh `EventPipe` is instantiated per test to avoid shared singleton state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DELIMITER = '!@#$%^!';

// Shared mock state for the fake node-ipc module. Hoisted so the vi.mock
// factory (which is itself hoisted) can reference it.
const mocks = vi.hoisted(() => {
  return {
    handlers: {} as Record<string, (...args: any[]) => void>,
    serve: vi.fn(),
    serverStart: vi.fn(),
    serverStop: vi.fn(),
    broadcast: vi.fn(),
    serverOn: vi.fn(),
    config: {} as Record<string, any>
  };
});

vi.mock('node-ipc', () => {
  return {
    default: {
      config: mocks.config,
      serve: mocks.serve,
      server: {
        start: mocks.serverStart,
        stop: mocks.serverStop,
        broadcast: mocks.broadcast,
        on: mocks.serverOn
      }
    }
  };
});

// Capture logger output so we can assert errors are logged rather than thrown.
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

vi.mock('../../../src/utils/logger.js', () => ({
  createLogger: () => loggerMock
}));

// Imported after the mocks are registered.
const { EventPipe, eventPipe } = await import('../../../src/services/event-pipe.js');
const { config } = await import('../../../src/utils/config.js');

let originalEnabled: boolean;

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so a per-test mockImplementation — e.g.
  // a throwing broadcast — never leaks into the next test.
  vi.resetAllMocks();

  // Reset captured connection handlers.
  for (const key of Object.keys(mocks.handlers)) delete mocks.handlers[key];

  // Default behaviours: serve invokes its callback synchronously, and the
  // server captures registered handlers so tests can fire them later.
  mocks.serve.mockImplementation((cb: () => void) => cb());
  mocks.serverOn.mockImplementation((event: string, handler: (...args: any[]) => void) => {
    mocks.handlers[event] = handler;
  });

  // Enable the pipe by default; individual tests can flip it off.
  originalEnabled = config.eventpipe.enabled;
  config.eventpipe.enabled = true;
});

afterEach(() => {
  config.eventpipe.enabled = originalEnabled;
});

/** Instantiate a fresh EventPipe and start it (serving). */
async function startedPipe(): Promise<InstanceType<typeof EventPipe>> {
  const pipe = new EventPipe();
  await pipe.start();
  mocks.broadcast.mockClear();
  return pipe;
}

function makeEvent(overrides: Partial<any> = {}): any {
  return {
    type: 'PlayerDoTurn',
    payload: { PlayerID: 0, Turn: 1 },
    ...overrides
  };
}

describe('EventPipe singleton', () => {
  it('exports a singleton instance', () => {
    expect(eventPipe).toBeInstanceOf(EventPipe);
  });
});

describe('EventPipe.broadcastBatch', () => {
  it('joins events with the delimiter and appends a trailing delimiter', async () => {
    const pipe = await startedPipe();
    const a = makeEvent({ id: 1 });
    const b = makeEvent({ id: 2, type: 'CityFounded' });

    pipe.broadcastBatch([a, b]);

    expect(mocks.broadcast).toHaveBeenCalledTimes(1);
    expect(mocks.broadcast).toHaveBeenCalledWith(
      JSON.stringify(a) + DELIMITER + JSON.stringify(b) + DELIMITER
    );
  });

  it('broadcasts a single event with a trailing delimiter', async () => {
    const pipe = await startedPipe();
    const a = makeEvent({ id: 7 });

    pipe.broadcastBatch([a]);

    expect(mocks.broadcast).toHaveBeenCalledTimes(1);
    expect(mocks.broadcast).toHaveBeenCalledWith(JSON.stringify(a) + DELIMITER);
  });

  it('no-ops when the event pipe is disabled', async () => {
    const pipe = await startedPipe();
    config.eventpipe.enabled = false;

    pipe.broadcastBatch([makeEvent()]);

    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it('no-ops when not serving', () => {
    const pipe = new EventPipe(); // never started

    pipe.broadcastBatch([makeEvent()]);

    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it('no-ops when the events array is empty', async () => {
    const pipe = await startedPipe();

    pipe.broadcastBatch([]);

    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it('no-ops while shutting down', async () => {
    const pipe = await startedPipe();
    // After stop() the pipe is both shutting down and no longer serving;
    // either guard suppresses the broadcast.
    await pipe.stop();
    mocks.broadcast.mockClear();

    pipe.broadcastBatch([makeEvent()]);

    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it('catches broadcast errors without throwing and logs them', async () => {
    const pipe = await startedPipe();
    mocks.broadcast.mockImplementation(() => {
      throw new Error('broadcast failed');
    });

    expect(() => pipe.broadcastBatch([makeEvent()])).not.toThrow();
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Error broadcasting event batch:',
      expect.any(Error)
    );
  });
});

describe('EventPipe.getStats', () => {
  it('reflects config and current connected-clients count', async () => {
    const pipe = await startedPipe();

    expect(pipe.getStats()).toEqual({
      enabled: true,
      clients: 0,
      pipeName: config.eventpipe.name
    });

    mocks.handlers['connect']?.();

    expect(pipe.getStats()).toEqual({
      enabled: true,
      clients: 1,
      pipeName: config.eventpipe.name
    });
  });

  it('reports enabled=false when the pipe is disabled', () => {
    config.eventpipe.enabled = false;
    const pipe = new EventPipe();

    expect(pipe.getStats().enabled).toBe(false);
  });
});

describe('EventPipe connect/disconnect handlers', () => {
  it('increments the client count and broadcasts a welcome payload on connect', async () => {
    const pipe = await startedPipe();

    mocks.handlers['connect']?.();

    expect(pipe.getStats().clients).toBe(1);
    expect(mocks.broadcast).toHaveBeenCalledTimes(1);
    const payload = mocks.broadcast.mock.calls[0][0] as string;
    expect(payload.endsWith(DELIMITER)).toBe(true);
    const parsed = JSON.parse(payload.slice(0, -DELIMITER.length));
    expect(parsed.type).toBe('connected');
  });

  it('decrements the client count on disconnect', async () => {
    const pipe = await startedPipe();

    mocks.handlers['connect']?.();
    mocks.handlers['connect']?.();
    expect(pipe.getStats().clients).toBe(2);

    mocks.handlers['disconnect']?.();
    expect(pipe.getStats().clients).toBe(1);
  });

  it('never drops the client count below zero', async () => {
    const pipe = await startedPipe();

    mocks.handlers['disconnect']?.();
    mocks.handlers['disconnect']?.();

    expect(pipe.getStats().clients).toBe(0);
  });

  it('logs server errors without throwing', async () => {
    await startedPipe();
    const err = new Error('pipe exploded');

    expect(() => mocks.handlers['error']?.(err)).not.toThrow();
    expect(loggerMock.error).toHaveBeenCalledWith('Event pipe server error:', err);
  });
});

describe('EventPipe.start', () => {
  it('early-returns when disabled and never serves', async () => {
    config.eventpipe.enabled = false;
    const pipe = new EventPipe();

    await pipe.start();

    expect(mocks.serve).not.toHaveBeenCalled();
    expect(pipe.getStats().clients).toBe(0);
  });

  it('serves and marks the pipe as serving once the serve callback fires', async () => {
    const pipe = new EventPipe();

    await pipe.start();

    expect(mocks.serve).toHaveBeenCalledTimes(1);
    expect(mocks.serverStart).toHaveBeenCalledTimes(1);
    // Serving state is observable through broadcastBatch working.
    pipe.broadcastBatch([makeEvent()]);
    expect(mocks.broadcast).toHaveBeenCalledTimes(1);
  });

  it('is idempotent when already serving', async () => {
    const pipe = new EventPipe();
    await pipe.start();
    await pipe.start();

    expect(mocks.serve).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith('Event pipe server already running');
  });
});

describe('EventPipe.stop', () => {
  it('broadcasts a goodbye payload, stops the server, and resets state', async () => {
    const pipe = await startedPipe();
    mocks.handlers['connect']?.();
    expect(pipe.getStats().clients).toBe(1);
    mocks.broadcast.mockClear();

    await pipe.stop();

    expect(mocks.broadcast).toHaveBeenCalledTimes(1);
    const payload = mocks.broadcast.mock.calls[0][0] as string;
    expect(payload.endsWith(DELIMITER)).toBe(true);
    const parsed = JSON.parse(payload.slice(0, -DELIMITER.length));
    expect(parsed.type).toBe('disconnecting');

    expect(mocks.serverStop).toHaveBeenCalledTimes(1);
    expect(pipe.getStats().clients).toBe(0);
  });

  it('is a no-op when not serving', async () => {
    const pipe = new EventPipe(); // never started

    await pipe.stop();

    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.serverStop).not.toHaveBeenCalled();
  });

  it('allows the server to be restarted after stopping', async () => {
    const pipe = await startedPipe();
    await pipe.stop();
    mocks.serve.mockClear();

    await pipe.start();

    expect(mocks.serve).toHaveBeenCalledTimes(1);
  });
});
