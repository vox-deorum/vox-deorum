/**
 * Tests for the inspect-deal Lua utility boundary.
 *
 * The live bridge returns a single Lua table directly as `response.result`; some
 * older mocks wrapped single returns in an array. These tests pin both shapes so
 * the utility works in live games without breaking existing mock-style callers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import { inspectDeal, enactDeal, type InspectDealResult } from '../../../src/utils/lua/inspect-deal.js';

/** Build a minimal successful inspect-deal payload. */
function result(): InspectDealResult {
  return {
    items: [],
    range: {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('inspectDeal Lua utility', () => {
  it('accepts the live bridge direct object result', async () => {
    const payload = result();
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success: true, result: payload } as any);

    await expect(inspectDeal(1, 3, [])).resolves.toBe(payload);
  });

  it('accepts an array-wrapped result for older mocks', async () => {
    const payload = result();
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success: true, result: [payload] } as any);

    await expect(inspectDeal(1, 3, [])).resolves.toBe(payload);
  });

  it('sends an explicit null for `enact` so read-only mode survives the appended promises argument', async () => {
    // proposedPromises was appended AFTER enact (position five) to leave enactDeal's call shape
    // alone, so read-only inspection now has to fill position four. It must arrive as Lua nil:
    // the args array is JSON-serialized to the DLL, and ConvertJsonToLuaValue maps JSON null to
    // lua_pushnil. Anything truthy there would silently switch the script into ENACT mode.
    const spy = vi
      .spyOn(LuaFunction.prototype, 'execute')
      .mockResolvedValue({ success: true, result: result() } as any);
    const promises = [{ promiserID: 1, recipientID: 3, promiseType: 'MILITARY' as const }];

    await inspectDeal(1, 3, [], promises);

    expect(spy).toHaveBeenCalledWith(1, 3, [], null, promises);
  });

  it('defaults the promises argument to an empty list', async () => {
    const spy = vi
      .spyOn(LuaFunction.prototype, 'execute')
      .mockResolvedValue({ success: true, result: result() } as any);

    await inspectDeal(1, 3, []);

    expect(spy).toHaveBeenCalledWith(1, 3, [], null, []);
  });

  it('leaves the enact-mode call shape untouched (four arguments, promises inside `enact`)', async () => {
    const spy = vi
      .spyOn(LuaFunction.prototype, 'execute')
      .mockResolvedValue({ success: true, result: { enacted: true, items: [] } } as any);
    const promises = [{ promiserID: 1, recipientID: 3, promiseType: 'MILITARY' as const }];

    await enactDeal(1, 3, [], promises);

    expect(spy).toHaveBeenCalledWith(1, 3, [], { promises });
  });
});
