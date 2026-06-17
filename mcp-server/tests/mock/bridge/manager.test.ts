/**
 * Mock-tier unit tests for BridgeManager (src/bridge/manager.ts).
 *
 * The bridge-service HTTP boundary (HttpClient), the event-pipe socket
 * (node:net createConnection) and the SSE client (eventsource) are all faked,
 * so these tests exercise the manager's own logic with no live socket/server:
 *   - HTTP request shaping for health / lua execute / pause / resume / players.
 *   - The queued Lua batch loop: success result mapping and error mapping.
 *   - Event-pipe delimiter parsing (incl. a frame split across chunks) and the
 *     pipe-error -> SSE fallback path, plus reconnect scheduling.
 *
 * Each test builds a fresh `new BridgeManager(...)` and calls `shutdown()` in
 * afterEach so the queue-processor loop and any timers are stopped (no leaks).
 */

// Mock the SSE client module so connectSSE() never opens a real connection.
import { vi } from 'vitest';

interface FakeEventSource {
  url: string;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((err: unknown) => void) | null;
  closed: boolean;
  close(): void;
}

// `vi.mock` is hoisted, so the instance registry and fake class must be created
// via vi.hoisted() to be available inside the (also hoisted) factory.
const { eventSourceInstances, FakeEventSource } = vi.hoisted(() => {
  const instances: any[] = [];
  class FakeEventSourceImpl {
    public url: string;
    public onopen: (() => void) | null = null;
    public onmessage: ((ev: { data: string }) => void) | null = null;
    public onerror: ((err: unknown) => void) | null = null;
    public closed = false;
    constructor(url: string) {
      this.url = url;
      instances.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  return { eventSourceInstances: instances as FakeEventSource[], FakeEventSource: FakeEventSourceImpl };
});

vi.mock('eventsource', () => ({
  EventSource: FakeEventSource,
}));

// node:net's namespace is not configurable in ESM, so we cannot vi.spyOn its
// createConnection. Mock the module and route createConnection to a per-test
// socket supplied through this hoisted holder.
const netHolder = vi.hoisted(() => ({ nextSocket: null as any }));
vi.mock('node:net', () => ({
  createConnection: (..._args: any[]) => netHolder.nextSocket,
}));

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { BridgeManager, type GameEvent } from '../../../src/bridge/manager.js';
import { HttpClient, HttpError } from '../../../src/bridge/http-client.js';

const PIPE_DELIM = '!@#$%^!';

/** A minimal fake of the net.Socket the event pipe uses. */
class FakeSocket extends EventEmitter {
  public encoding: string | null = null;
  public destroyed = false;
  setEncoding(enc: string) {
    this.encoding = enc;
    return this;
  }
  destroy() {
    this.destroyed = true;
    return this;
  }
}

let manager: BridgeManager;
let getSpy: ReturnType<typeof vi.spyOn>;
let postSpy: ReturnType<typeof vi.spyOn>;
let deleteSpy: ReturnType<typeof vi.spyOn>;

/** Force the manager's DLL-connected state via the public checkHealth() path. */
async function markDllConnected(connected: boolean) {
  getSpy.mockResolvedValueOnce({
    result: { success: true, dll_connected: connected, uptime: 1, version: 'x' },
  } as any);
  await manager.checkHealth();
}

beforeEach(() => {
  vi.useFakeTimers();
  // Stub the HTTP boundary before construction (the constructor's queue loop
  // immediately fires resumeGame()).
  getSpy = vi.spyOn(HttpClient.prototype, 'get').mockResolvedValue({} as any);
  postSpy = vi.spyOn(HttpClient.prototype, 'post').mockResolvedValue({ success: true } as any);
  deleteSpy = vi.spyOn(HttpClient.prototype, 'delete').mockResolvedValue({ success: true } as any);
  vi.spyOn(HttpClient.prototype, 'shutdown').mockResolvedValue();

  manager = new BridgeManager('http://test-bridge:9999');
});

afterEach(async () => {
  await manager.shutdown();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  eventSourceInstances.length = 0;
});

describe('BridgeManager HTTP request shaping', () => {
  it('checkHealth GETs /health and reflects dll_connected', async () => {
    getSpy.mockResolvedValueOnce({
      result: { success: true, dll_connected: true, uptime: 42, version: '1.2.3' },
    } as any);

    const health = await manager.checkHealth();

    expect(getSpy).toHaveBeenCalledWith('/health');
    expect(health.dll_connected).toBe(true);
    expect(health.version).toBe('1.2.3');
    expect(manager.dllConnected).toBe(true);
  });

  it('executeLuaScript POSTs /lua/execute with the script body (fast pool)', async () => {
    postSpy.mockResolvedValueOnce({ success: true, result: 7 } as any);

    const res = await manager.executeLuaScript('return 1+1');

    expect(postSpy).toHaveBeenCalledWith('/lua/execute', { script: 'return 1+1' }, { fast: true });
    expect(res).toEqual({ success: true, result: 7 });
  });

  it('executeLuaScript maps an HttpError into a NETWORK/HTTP error LuaResponse', async () => {
    postSpy.mockRejectedValueOnce(new HttpError('boom', 500, 'HTTP_REQUEST_FAILED'));

    const res = await manager.executeLuaScript('bad');

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('HTTP_REQUEST_FAILED');
    expect(res.error?.message).toBe('boom');
  });

  it('pauseGame POSTs /external/pause and returns the success flag', async () => {
    postSpy.mockResolvedValueOnce({ success: true } as any);
    const ok = await manager.pauseGame();
    expect(postSpy).toHaveBeenCalledWith('/external/pause', undefined, { fast: true });
    expect(ok).toBe(true);
  });

  it('pauseGame returns false (swallows) when the request throws', async () => {
    postSpy.mockRejectedValueOnce(new HttpError('down', undefined, 'CONNECTION_FAILED'));
    const ok = await manager.pauseGame();
    expect(ok).toBe(false);
  });

  it('resumeGame POSTs /external/resume and returns the success flag', async () => {
    postSpy.mockResolvedValueOnce({ success: true } as any);
    const ok = await manager.resumeGame();
    expect(postSpy).toHaveBeenCalledWith('/external/resume', undefined, { fast: true });
    expect(ok).toBe(true);
  });

  it('pausePlayer / resumePlayer POST and DELETE the per-player route', async () => {
    await manager.pausePlayer(3);
    expect(postSpy).toHaveBeenCalledWith('/external/pause-player/3', undefined, { fast: true });

    await manager.resumePlayer(3);
    expect(deleteSpy).toHaveBeenCalledWith('/external/pause-player/3', { fast: true });
  });
});

describe('BridgeManager queued Lua batch', () => {
  it('rejects immediately with DLL_DISCONNECTED when the DLL is down', async () => {
    // DLL starts disconnected; no batch POST should be needed.
    const res = await manager.callLuaFunction('GetSomething', [1]);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('DLL_DISCONNECTED');
  });

  it('batches queued calls to /lua/batch and maps results back per call', async () => {
    await markDllConnected(true);

    // The batch POST shape: [{ function, args }, ...] -> { result: { results: [...] } }.
    postSpy.mockImplementation(async (path: string, body?: unknown) => {
      if (path === '/lua/batch') {
        const calls = body as Array<{ function: string; args: any[] }>;
        return {
          success: true,
          result: {
            results: calls.map((c) => ({ success: true, result: `${c.function}:${c.args[0]}` })),
          },
        } as any;
      }
      return { success: true } as any;
    });

    const p1 = manager.callLuaFunction('Foo', [10]);
    const p2 = manager.callLuaFunction('Bar', [20]);

    // Drive the queue-processor loop (it polls with timers).
    await vi.advanceTimersByTimeAsync(50);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toEqual({ success: true, result: 'Foo:10' });
    expect(r2).toEqual({ success: true, result: 'Bar:20' });

    const batchCall = postSpy.mock.calls.find((c) => c[0] === '/lua/batch');
    expect(batchCall).toBeDefined();
    expect(batchCall![1]).toEqual([
      { function: 'Foo', args: [10] },
      { function: 'Bar', args: [20] },
    ]);
  });

  it('maps a whole-batch failure to BATCH_ERROR for every call', async () => {
    await markDllConnected(true);

    postSpy.mockImplementation(async (path: string) => {
      if (path === '/lua/batch') {
        return { success: false, error: { message: 'engine exploded' } } as any;
      }
      return { success: true } as any;
    });

    const p = manager.callLuaFunction('Foo', []);
    await vi.advanceTimersByTimeAsync(50);
    const res = await p;

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('BATCH_ERROR');
    expect(res.error?.message).toBe('engine exploded');
  });

  it('maps a thrown batch request to a NETWORK/HTTP error for every call', async () => {
    await markDllConnected(true);

    postSpy.mockImplementation(async (path: string) => {
      if (path === '/lua/batch') {
        throw new HttpError('connection lost', undefined, 'CONNECTION_FAILED');
      }
      return { success: true } as any;
    });

    const p = manager.callLuaFunction('Foo', []);
    await vi.advanceTimersByTimeAsync(50);
    const res = await p;

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('CONNECTION_FAILED');
    expect(res.error?.message).toBe('connection lost');
  });
});

describe('BridgeManager event-pipe parsing', () => {
  let socket: FakeSocket;

  beforeEach(() => {
    socket = new FakeSocket();
    netHolder.nextSocket = socket;
  });

  it('parses delimited frames in a single chunk into GameEvents', () => {
    const received: GameEvent[] = [];
    manager.on('gameEvent', (e) => received.push(e));

    manager.connectEventPipe();
    socket.emit('connect');

    const e1: GameEvent = { type: 'turn', payload: { turn: 1 }, timestamp: 't1' };
    const e2: GameEvent = { type: 'combat', payload: { winner: 'a' }, timestamp: 't2' };
    socket.emit('data', JSON.stringify(e1) + PIPE_DELIM + JSON.stringify(e2) + PIPE_DELIM);

    expect(received).toEqual([e1, e2]);
  });

  it('handles a frame split across two chunks (buffering)', () => {
    const received: GameEvent[] = [];
    manager.on('gameEvent', (e) => received.push(e));

    manager.connectEventPipe();
    socket.emit('connect');

    const e1: GameEvent = { type: 'event', payload: { a: 1, b: 'two' }, timestamp: 'ts' };
    const full = JSON.stringify(e1) + PIPE_DELIM;
    const mid = Math.floor(full.length / 2);

    socket.emit('data', full.slice(0, mid)); // incomplete -> buffered
    expect(received).toHaveLength(0);

    socket.emit('data', full.slice(mid)); // completes the frame
    expect(received).toEqual([e1]);
  });

  it('flips dllConnected from a dll_status event and emits gameEvent', () => {
    const received: GameEvent[] = [];
    manager.on('gameEvent', (e) => received.push(e));

    manager.connectEventPipe();
    socket.emit('connect');

    expect(manager.dllConnected).toBe(false);
    const ev: GameEvent = { type: 'dll_status', payload: { connected: true }, timestamp: 'ts' };
    socket.emit('data', JSON.stringify(ev) + PIPE_DELIM);

    expect(manager.dllConnected).toBe(true);
    expect(received).toEqual([ev]);
  });

  it('ignores a malformed frame but still parses surrounding valid ones', () => {
    const received: GameEvent[] = [];
    manager.on('gameEvent', (e) => received.push(e));

    manager.connectEventPipe();
    socket.emit('connect');

    const good: GameEvent = { type: 'ok', payload: {}, timestamp: 'ts' };
    socket.emit('data', '{not json}' + PIPE_DELIM + JSON.stringify(good) + PIPE_DELIM);

    expect(received).toEqual([good]);
  });
});

describe('BridgeManager event-pipe -> SSE fallback & reconnect', () => {
  let socket: FakeSocket;

  beforeEach(() => {
    socket = new FakeSocket();
    netHolder.nextSocket = socket;
  });

  it('falls back to SSE when the event pipe errors', () => {
    manager.connectEventPipe();

    expect(eventSourceInstances).toHaveLength(0);
    socket.emit('error', new Error('pipe gone'));

    expect(socket.destroyed).toBe(true);
    expect(eventSourceInstances).toHaveLength(1);
    expect(eventSourceInstances[0].url).toBe('http://test-bridge:9999/events');
  });

  it('parses GameEvents arriving over the SSE fallback', () => {
    const received: GameEvent[] = [];
    manager.on('gameEvent', (e) => received.push(e));

    manager.connectEventPipe();
    socket.emit('error', new Error('pipe gone'));

    const es = eventSourceInstances[0];
    es.onopen?.();
    const ev: GameEvent = { type: 'sse', payload: { x: 1 }, timestamp: 'ts' };
    es.onmessage?.({ data: JSON.stringify(ev) });

    expect(received).toEqual([ev]);
  });

  it('schedules a reconnect (~1s) when the SSE connection errors', () => {
    manager.connectEventPipe();
    socket.emit('error', new Error('pipe gone')); // -> SSE fallback (instance #0)

    const es = eventSourceInstances[0];
    const sseCountBefore = eventSourceInstances.length;

    // Hand the next reconnect attempt a fresh socket so we can detect a re-open.
    const reconnectSocket = new FakeSocket();
    netHolder.nextSocket = reconnectSocket;

    // SSE error -> scheduleReconnect() sets a ~1s timer.
    es.onerror?.(new Error('sse dropped'));
    expect(reconnectSocket.encoding).toBeNull(); // not yet reconnected

    vi.advanceTimersByTime(1000);

    // Reconnect ran: with the event pipe enabled it re-opens the pipe (fresh
    // socket configured); otherwise it would open another SSE connection.
    const reconnectedViaPipe = reconnectSocket.encoding === 'utf8';
    const reconnectedViaSse = eventSourceInstances.length > sseCountBefore;
    expect(reconnectedViaPipe || reconnectedViaSse).toBe(true);
  });
});
