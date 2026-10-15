import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import { enumMappings } from '../../../src/utils/knowledge/enum.js';
import createSummarizeUnitsTool from '../../../src/tools/knowledge/summarize-units.js';
import { connectToolClient } from '../tool-client.js';

const tool = createSummarizeUnitsTool();
const originalUnitTypes = enumMappings.UnitType;
const originalAITypes = enumMappings.AIType;
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  enumMappings.UnitType = { 1: 'Warrior', 2: 'Archer' };
  enumMappings.AIType = { 1: 'AI_ATTACK', 2: 'AI_DEFENSE' };
  vi.spyOn(LuaFunction.prototype, 'execute').mockImplementation(async function (...args: any[]) {
    const result = args[0] === 0
      ? {
        Rome: {
          1: { 1: { Count: 2, Strength: 8 }, 2: { Count: 1, RangedStrength: 6 } },
          2: { 1: 1 },
        },
        Egypt: { 1: { 1: { Count: 3, Strength: 9 } } },
      }
      : { Greece: { 2: { 2: { Count: 6, Strength: 12 } } } };
    return { success: true, result } as any;
  });
  client = await connectToolClient(tool);
});

afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
  if (originalUnitTypes) enumMappings.UnitType = originalUnitTypes;
  else delete enumMappings.UnitType;
  if (originalAITypes) enumMappings.AIType = originalAITypes;
  else delete enumMappings.AIType;
});

describe('summarize-units', () => {
  it('groups visible units by civilization and AI type with military stats', async () => {
    const result = await client.call({ PlayerID: 0 });

    expect(result.Result.Rome.AI_ATTACK).toMatchObject({
      Warrior: { Count: 2, Strength: 8 },
      Archer: { Count: 1, RangedStrength: 6 },
    });
    expect(result.Result.Rome.AI_DEFENSE.Warrior).toBe(1);
    expect(result.Result.Egypt.AI_ATTACK.Warrior).toMatchObject({ Count: 3, Strength: 9 });
    expect(result.Result).not.toHaveProperty('Greece');

    const otherViewer = await client.call({ PlayerID: 1 });
    expect(otherViewer.Result.Greece.AI_DEFENSE.Archer).toMatchObject({ Count: 6, Strength: 12 });
    expect(otherViewer.Result).not.toHaveProperty('Rome');
  });
});
