/**
 * @module tests/mock/web/sse-manager
 *
 * Unit tests for {@link SSEManager}. The manager owns raw Express `Response` clients,
 * so we drive it with a hand-written stub that records header writes, frame writes,
 * `end()` calls, and the `close` listener it registers. No real Express/HTTP.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Response } from 'express';
import { SSEManager } from '../../../src/web/sse-manager.js';

/** Minimal stand-in for the slice of Express `Response` the SSE manager touches. */
interface FakeResponse extends Response {
  headers: Record<string, string>;
  writes: string[];
  ended: boolean;
  closeHandlers: Array<() => void>;
  triggerClose(): void;
  failNextWrite(error?: Error): void;
}

function makeRes(): FakeResponse {
  const res = {
    headers: {} as Record<string, string>,
    writes: [] as string[],
    ended: false,
    closeHandlers: [] as Array<() => void>,
    _writeError: null as Error | null,
  } as unknown as FakeResponse & { _writeError: Error | null };

  res.setHeader = vi.fn((name: string, value: string) => {
    res.headers[name] = value;
    return res;
  }) as unknown as Response['setHeader'];

  res.write = vi.fn((chunk: string) => {
    if (res._writeError) {
      const err = res._writeError;
      res._writeError = null;
      throw err;
    }
    res.writes.push(chunk);
    return true;
  }) as unknown as Response['write'];

  res.end = vi.fn(() => {
    res.ended = true;
    return res;
  }) as unknown as Response['end'];

  res.on = vi.fn((event: string, handler: () => void) => {
    if (event === 'close') res.closeHandlers.push(handler);
    return res;
  }) as unknown as Response['on'];

  res.triggerClose = () => res.closeHandlers.forEach(h => h());
  res.failNextWrite = (error = new Error('client gone')) => {
    res._writeError = error;
  };

  return res;
}

describe('SSEManager', () => {
  let manager: SSEManager;

  beforeEach(() => {
    manager = new SSEManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('addClient', () => {
    it('sets SSE headers, sends an initial heartbeat, and tracks the client', () => {
      const res = makeRes();
      manager.addClient(res);

      expect(res.headers['Content-Type']).toBe('text/event-stream');
      expect(res.headers['Cache-Control']).toBe('no-cache');
      expect(res.headers['Connection']).toBe('keep-alive');
      expect(res.headers['X-Accel-Buffering']).toBe('no');

      expect(res.writes).toEqual(['event: heartbeat\n\n']);
      expect(manager.getClientCount()).toBe(1);
    });

    it('removes the client when its connection closes', () => {
      const res = makeRes();
      manager.addClient(res);
      expect(manager.getClientCount()).toBe(1);

      res.triggerClose();
      expect(manager.getClientCount()).toBe(0);
    });

    it('tracks multiple independent clients', () => {
      const a = makeRes();
      const b = makeRes();
      manager.addClient(a);
      manager.addClient(b);
      expect(manager.getClientCount()).toBe(2);

      a.triggerClose();
      expect(manager.getClientCount()).toBe(1);
    });
  });

  describe('broadcast', () => {
    it('writes an event/data frame with JSON-serialized data to every client', () => {
      const a = makeRes();
      const b = makeRes();
      manager.addClient(a);
      manager.addClient(b);

      manager.broadcast('span', { id: 7, name: 'x' });

      const frame = 'event: span\ndata: {"id":7,"name":"x"}\n\n';
      expect(a.writes).toContain(frame);
      expect(b.writes).toContain(frame);
    });

    it('tolerates a write failure on one client without affecting others', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const ok = makeRes();
      const broken = makeRes();
      manager.addClient(ok);
      manager.addClient(broken);
      broken.failNextWrite();

      expect(() => manager.broadcast('log', { line: 'hi' })).not.toThrow();

      const frame = 'event: log\ndata: {"line":"hi"}\n\n';
      expect(ok.writes).toContain(frame);
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('sendHeartbeat', () => {
    it('writes a heartbeat frame to all clients', () => {
      const a = makeRes();
      manager.addClient(a);
      a.writes.length = 0; // drop the initial connect heartbeat

      manager.sendHeartbeat();
      expect(a.writes).toEqual(['event: heartbeat\n\n']);
    });

    it('swallows write errors silently', () => {
      const broken = makeRes();
      manager.addClient(broken);
      broken.failNextWrite();
      expect(() => manager.sendHeartbeat()).not.toThrow();
    });
  });

  describe('closeAll', () => {
    it('ends every client connection and clears the set', () => {
      const a = makeRes();
      const b = makeRes();
      manager.addClient(a);
      manager.addClient(b);

      manager.closeAll();

      expect(a.ended).toBe(true);
      expect(b.ended).toBe(true);
      expect(manager.getClientCount()).toBe(0);
    });

    it('clears clients even when end() throws', () => {
      const res = makeRes();
      manager.addClient(res);
      (res.end as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('already gone');
      });

      expect(() => manager.closeAll()).not.toThrow();
      expect(manager.getClientCount()).toBe(0);
    });
  });

  describe('startHeartbeat', () => {
    it('sends heartbeats on the configured interval with fake timers', () => {
      vi.useFakeTimers();
      try {
        const res = makeRes();
        manager.addClient(res);
        res.writes.length = 0;

        const interval = manager.startHeartbeat(5000);

        vi.advanceTimersByTime(5000);
        expect(res.writes).toEqual(['event: heartbeat\n\n']);

        vi.advanceTimersByTime(5000);
        expect(res.writes).toHaveLength(2);

        clearInterval(interval);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
