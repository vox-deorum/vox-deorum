/**
 * Tests for the inspect-deal Lua utility boundary.
 *
 * The live bridge returns a single Lua table directly as `response.result`; some
 * older mocks wrapped single returns in an array. These tests pin both shapes so
 * the utility works in live games without breaking existing mock-style callers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import { inspectDeal, type InspectDealResult } from '../../../src/utils/lua/inspect-deal.js';

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
});
