/**
 * Tests for the game-identity getter: syncGameIdentity is a thin wrapper around a Lua
 * call. We mock the Lua boundary (LuaFunction.prototype.execute) and assert the
 * success/failure mapping. Date.now()/crypto.randomUUID() run for real.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { LuaFunction } from '../../../../src/bridge/lua-function.js';
import { syncGameIdentity } from '../../../../src/knowledge/getters/game-identity.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('syncGameIdentity', () => {
  it('returns the Lua result on success', async () => {
    const identity = { gameId: 'abc-123', turn: 42, activePlayerId: 0, timestamp: 1700000000 };
    const spy = vi
      .spyOn(LuaFunction.prototype, 'execute')
      .mockResolvedValue({ success: true, result: identity } as any);

    const result = await syncGameIdentity();
    expect(result).toEqual(identity);

    // Called with a numeric timestamp and a string UUID.
    expect(spy).toHaveBeenCalledTimes(1);
    const [time, uuid] = spy.mock.calls[0];
    expect(typeof time).toBe('number');
    expect(typeof uuid).toBe('string');
    expect(uuid.length).toBeGreaterThan(0);
  });

  it('returns undefined when the Lua call fails', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
      success: false,
      error: { code: 'BOOM', message: 'nope' },
    } as any);

    expect(await syncGameIdentity()).toBeUndefined();
  });

  it('throws when the Lua call succeeds but returns no result', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
      success: true,
      result: undefined,
    } as any);

    await expect(syncGameIdentity()).rejects.toThrow(/serialization/i);
  });
});
