/**
 * Tests for the set-research action tool. The Lua boundary is stubbed (no bridge); the
 * enum name<->id resolution (TechID), validation-failure handling, the ResearchChanges
 * store write, and the replay push run for real against an in-memory KnowledgeStore.
 * The game enum map is injected since the mock tier has no DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore, actionPushes } from '../helpers.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import { enumMappings } from '../../../src/utils/knowledge/enum.js';
import createSetResearchTool from '../../../src/tools/actions/set-research.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { connectToolClient } from '../tool-client.js';

const tool = createSetResearchTool();
let store: KnowledgeStore;
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  store = await setupStore(10);
  enumMappings.TechID = { 5: 'Pottery', 6: 'Writing' };
  client = await connectToolClient(tool);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await client.close();
  delete (enumMappings as any).TechID;
  await store.close();
});

/** Stub the Lua boundary so super.call() returns a canned previous tech id result. */
function mockLua(result: Record<string, number>) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
    success: true,
    result,
  } as any);
}

describe('set-research', () => {
  it('throws for a technology name that resolves to no enum value', async () => {
    mockLua({ Previous: -1 });
    await expect(
      client.call({ PlayerID: 0, Technology: 'Nonexistent', Rationale: 'r' })
    ).rejects.toThrow();
  });

  it('resolves the tech name, stores a ResearchChanges row, stamps the turn, and pushes the before/after names', async () => {
    mockLua({ Previous: 5 }); // previously Pottery

    await client.call({ PlayerID: 0, Technology: 'Writing', Rationale: 'go wide' });

    const row = (await store.getMutableKnowledge('ResearchChanges', 0))!;
    expect(row).not.toBeNull();
    expect(row.Technology).toBe('Writing');
    expect(row.Rationale).toBe('go wide');
    expect(row.Turn).toBe(10);

    const pushes = actionPushes();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ playerID: 0, actionType: 'research', replayPrefix: 'Changed next research', rationale: 'go wide', turn: 10 });
    expect(pushes[0].summary).toContain('Pottery');
    expect(pushes[0].summary).toContain('Writing');
  });

  it('throws and writes no store row or push on a validation failure (already researched, Next === -2)', async () => {
    mockLua({ Next: -2 });

    await expect(
      client.call({ PlayerID: 0, Technology: 'Writing', Rationale: 'r' })
    ).rejects.toThrow();
    expect(await store.getMutableKnowledgeHistory('ResearchChanges', 0)).toHaveLength(0);
    expect(actionPushes()).toHaveLength(0);
  });

  it('does no store write or push when the Lua call fails', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success: false } as any);

    const result = await client.call({ PlayerID: 0, Technology: 'Writing', Rationale: 'r' });
    expect(result.Success).toBe(false);
    expect(await store.getMutableKnowledgeHistory('ResearchChanges', 0)).toHaveLength(0);
    expect(actionPushes()).toHaveLength(0);
  });
});
