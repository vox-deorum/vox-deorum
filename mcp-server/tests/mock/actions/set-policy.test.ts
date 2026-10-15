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
import createSetPolicyTool from '../../../src/tools/actions/set-policy.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { connectToolClient } from '../tool-client.js';

const tool = createSetPolicyTool();
let store: KnowledgeStore;
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  store = await setupStore(10);
  enumMappings.BranchType = { 1: 'Tradition', 2: 'Liberty' };
  enumMappings.PolicyID = { 10: 'Aristocracy', 11: 'Legalism' };
  client = await connectToolClient(tool);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await client.close();
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
  it('throws for a policy name that resolves to no enum value', async () => {
    mockLua({ PreviousPolicy: -1, PreviousBranch: -1 });
    await expect(
      client.call({ PlayerID: 0, Policy: 'Nonexistent', Rationale: 'r' })
    ).rejects.toThrow();
  });

  it('resolves a branch name, stores it as a branch, and stamps the turn', async () => {
    mockLua({ PreviousPolicy: -1, PreviousBranch: -1 });

    await client.call({ PlayerID: 0, Policy: 'Liberty (New Branch)', Rationale: 'expand' });

    const row = (await store.getMutableKnowledge('PolicyChanges', 0))!;
    expect(row).not.toBeNull();
    expect(row.Policy).toBe('Liberty'); // parenthetical stripped
    expect(row.IsBranch).toBe(1);
    expect(row.Rationale).toBe('expand');
    expect(row.Turn).toBe(10);
  });

  it('resolves an individual policy name and stores it as a non-branch', async () => {
    mockLua({ PreviousPolicy: -1, PreviousBranch: -1 });

    await client.call({ PlayerID: 0, Policy: 'Aristocracy', Rationale: 'tall' });

    const row = (await store.getMutableKnowledge('PolicyChanges', 0))!;
    expect(row.Policy).toBe('Aristocracy');
    expect(row.IsBranch).toBe(0);
  });

  it('throws and writes nothing on a validation failure (Next === -1)', async () => {
    mockLua({ Next: -1 });

    await expect(
      client.call({ PlayerID: 0, Policy: 'Liberty', Rationale: 'r' })
    ).rejects.toThrow();
    expect(await store.getMutableKnowledgeHistory('PolicyChanges', 0)).toHaveLength(0);
  });

  it('does no store write or push when the Lua call fails', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success: false } as any);

    const result = await client.call({ PlayerID: 0, Policy: 'Liberty', Rationale: 'r' });
    expect(result.Success).toBe(false);
    expect(await store.getMutableKnowledgeHistory('PolicyChanges', 0)).toHaveLength(0);
  });
});
