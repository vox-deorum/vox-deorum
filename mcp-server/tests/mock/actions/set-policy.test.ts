/**
 * Tests for the set-policy action tool. The Lua boundary is stubbed (no bridge); the
 * enum name<->id resolution (BranchType / PolicyID), validation-failure handling, the
 * PolicyChanges store write, and the replay push run for real against an in-memory
 * KnowledgeStore. The game enum maps are injected since the mock tier has no DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import { enumMappings } from '../../../src/utils/knowledge/enum.js';
import * as playerActions from '../../../src/utils/lua/player-actions.js';
import createSetPolicyTool from '../../../src/tools/actions/set-policy.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createSetPolicyTool();
let store: KnowledgeStore;
let pushSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  store = await setupStore(10);
  enumMappings.BranchType = { 1: 'Tradition', 2: 'Liberty' };
  enumMappings.PolicyID = { 10: 'Aristocracy', 11: 'Legalism' };
  pushSpy = vi.spyOn(playerActions, 'pushPlayerAction').mockResolvedValue();
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete (enumMappings as any).BranchType;
  delete (enumMappings as any).PolicyID;
  await store.close();
});

/** Stub the Lua boundary so super.call() returns canned previous policy/branch ids. */
function mockLua(result: Record<string, number>) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
    success: true,
    result,
  } as any);
}

describe('set-policy', () => {
  describe('schema validation', () => {
    it('rejects a missing Policy', () => {
      const parsed = tool.inputSchema.safeParse({ PlayerID: 0, Rationale: 'r' });
      expect(parsed.success).toBe(false);
    });

    it('accepts a valid payload', () => {
      const parsed = tool.inputSchema.safeParse({ PlayerID: 0, Policy: 'Tradition', Rationale: 'r' });
      expect(parsed.success).toBe(true);
    });
  });

  it('throws for a policy name that resolves to no enum value', async () => {
    mockLua({ PreviousPolicy: -1, PreviousBranch: -1 });
    await expect(
      tool.execute({ PlayerID: 0, Policy: 'Nonexistent', Rationale: 'r' } as any)
    ).rejects.toThrow(/not found/);
  });

  it('resolves a branch name, stores it as a branch, and stamps the turn', async () => {
    mockLua({ PreviousPolicy: -1, PreviousBranch: -1 });

    await tool.execute({ PlayerID: 0, Policy: 'Liberty (New Branch)', Rationale: 'expand' } as any);

    const row = (await store.getMutableKnowledge('PolicyChanges', 0))!;
    expect(row).not.toBeNull();
    expect(row.Policy).toBe('Liberty'); // parenthetical stripped
    expect(row.IsBranch).toBe(1);
    expect(row.Rationale).toBe('expand');
    expect(row.Turn).toBe(10);
  });

  it('resolves an individual policy name and stores it as a non-branch', async () => {
    mockLua({ PreviousPolicy: -1, PreviousBranch: -1 });

    await tool.execute({ PlayerID: 0, Policy: 'Aristocracy', Rationale: 'tall' } as any);

    const row = (await store.getMutableKnowledge('PolicyChanges', 0))!;
    expect(row.Policy).toBe('Aristocracy');
    expect(row.IsBranch).toBe(0);
  });

  it('resolves the previous branch id back to a name in the replay summary', async () => {
    mockLua({ PreviousPolicy: -1, PreviousBranch: 1 }); // previously Tradition

    await tool.execute({ PlayerID: 0, Policy: 'Liberty', Rationale: 'switch' } as any);

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const [playerID, actionType, summary, rationale, prefix] = pushSpy.mock.calls[0];
    expect(playerID).toBe(0);
    expect(actionType).toBe('policy');
    expect(prefix).toBe('Changed next policy branch');
    expect(rationale).toBe('switch');
    expect(summary).toBe('Tradition → Liberty');
  });

  it('throws and writes nothing on a validation failure (Next === -1)', async () => {
    mockLua({ Next: -1 });

    await expect(
      tool.execute({ PlayerID: 0, Policy: 'Liberty', Rationale: 'r' } as any)
    ).rejects.toThrow(/not currently available/);
    expect(await store.getMutableKnowledgeHistory('PolicyChanges', 0)).toHaveLength(0);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('does no store write or push when the Lua call fails', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success: false } as any);

    const result = await tool.execute({ PlayerID: 0, Policy: 'Liberty', Rationale: 'r' } as any);
    expect(result.Success).toBe(false);
    expect(await store.getMutableKnowledgeHistory('PolicyChanges', 0)).toHaveLength(0);
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
