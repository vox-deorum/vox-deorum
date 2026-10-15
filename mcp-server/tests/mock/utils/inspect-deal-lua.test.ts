/** Tests inspect and enact behavior through a Lua boundary that models mode selection. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import { inspectDeal, enactDeal, type InspectDealResult } from '../../../src/utils/lua/inspect-deal.js';

/** Build a small read-only inspection result with caller-visible deal data. */
function inspection(): InspectDealResult {
  return {
    items: [{ fromPlayerID: 1, toPlayerID: 3, itemType: 'GOLD', amount: 40 }],
    range: { gold: { minimum: 0, maximum: 100 } },
  } as InspectDealResult;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('inspectDeal Lua boundary', () => {
  it('returns the inspection data from a direct Lua result', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
      success: true,
      result: inspection(),
    } as any);

    await expect(inspectDeal(1, 3, [])).resolves.toEqual(inspection());
  });

  it('accepts the older array-wrapped Lua response shape', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
      success: true,
      result: [inspection()],
    } as any);

    await expect(inspectDeal(1, 3, [])).resolves.toEqual(inspection());
  });

  it('keeps proposed promises in read-only inspection mode', async () => {
    let enacted = false;
    const inspectResult = inspection();
    vi.spyOn(LuaFunction.prototype, 'execute').mockImplementation(async (...args: any[]) => {
      // Lua treats a truthy fourth argument as enact mode. The fake models that
      // observable difference so a misplaced promises list fails this check.
      if (args[3]) {
        enacted = true;
        return { success: true, result: { enacted: true, items: [] } } as any;
      }
      return { success: true, result: inspectResult } as any;
    });

    const proposedPromises = [{ promiserID: 1, recipientID: 3, promiseType: 'MILITARY' as const }];
    const output = await inspectDeal(1, 3, [], proposedPromises);

    expect(output).toEqual(inspectResult);
    expect(enacted).toBe(false);
  });

  it('supplies an empty promise list when callers omit promises', async () => {
    let promiseList: unknown;
    vi.spyOn(LuaFunction.prototype, 'execute').mockImplementation(async (...args: any[]) => {
      if (args[3]) return { success: true, result: { enacted: true } } as any;
      promiseList = args[4];
      return { success: true, result: inspection() } as any;
    });

    await inspectDeal(1, 3, []);

    expect(promiseList).toEqual([]);
  });

  it('activates enact mode and returns its distinct result', async () => {
    let enacted = false;
    vi.spyOn(LuaFunction.prototype, 'execute').mockImplementation(async (...args: any[]) => {
      if (args[3]) {
        enacted = true;
        return { success: true, result: { enacted: true, acceptedItems: [{ itemType: 'GOLD', amount: 40 }] } } as any;
      }
      return { success: true, result: inspection() } as any;
    });

    const output = await enactDeal(1, 3, [], [{ promiserID: 1, recipientID: 3, promiseType: 'MILITARY' }]);

    expect(enacted).toBe(true);
    expect(output).toEqual({ enacted: true, acceptedItems: [{ itemType: 'GOLD', amount: 40 }] });
  });
});
