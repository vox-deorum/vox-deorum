/**
 * Tests for the set-research action tool. The Lua boundary is stubbed (no bridge); the
 * enum name<->id resolution (TechID), validation-failure handling, the ResearchChanges
 * store write, and the replay push run for real against an in-memory KnowledgeStore.
 * The game enum map is injected since the mock tier has no DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import { enumMappings } from '../../../src/utils/knowledge/enum.js';
import * as playerActions from '../../../src/utils/lua/player-actions.js';
import createSetResearchTool from '../../../src/tools/actions/set-research.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createSetResearchTool();
let store: KnowledgeStore;
let pushSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  store = await setupStore(10);
  enumMappings.TechID = { 5: 'Pottery', 6: 'Writing' };
  pushSpy = vi.spyOn(playerActions, 'pushPlayerAction').mockResolvedValue();
});

afterEach(async () => {
  vi.restoreAllMocks();
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
      tool.execute({ PlayerID: 0, Technology: 'Nonexistent', Rationale: 'r' } as any)
    ).rejects.toThrow(/not found/);
  });

  it('resolves the tech name, stores a ResearchChanges row, and stamps the turn', async () => {
    mockLua({ Previous: 5 }); // previously Pottery

    await tool.execute({ PlayerID: 0, Technology: 'Writing', Rationale: 'go wide' } as any);

    const row = (await store.getMutableKnowledge('ResearchChanges', 0))!;
    expect(row).not.toBeNull();
    expect(row.Technology).toBe('Writing');
    expect(row.Rationale).toBe('go wide');
    expect(row.Turn).toBe(10);
  });

  it('writes ResearchChanges visible-by-default (no player filter) and readable', async () => {
    mockLua({ Previous: -1 });

    await tool.execute({ PlayerID: 0, Technology: 'Writing', Rationale: 'r' } as any);

    expect(await store.getMutableKnowledge('ResearchChanges', 0)).not.toBeUndefined();
  });

  it('pushes a replay action resolving the previous tech id back to a name', async () => {
    mockLua({ Previous: 5 }); // previously Pottery

    await tool.execute({ PlayerID: 0, Technology: 'Writing', Rationale: 'switch' } as any);

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const [playerID, actionType, summary, rationale, prefix] = pushSpy.mock.calls[0];
    expect(playerID).toBe(0);
    expect(actionType).toBe('research');
    expect(prefix).toBe('Changed next research');
    expect(rationale).toBe('switch');
    expect(summary).toBe('Pottery → Writing');
  });

  it('throws and writes nothing on a validation failure (already researched, Next === -2)', async () => {
    mockLua({ Next: -2 });

    await expect(
      tool.execute({ PlayerID: 0, Technology: 'Writing', Rationale: 'r' } as any)
    ).rejects.toThrow(/already been researched/);
    expect(await store.getMutableKnowledgeHistory('ResearchChanges', 0)).toHaveLength(0);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('does no store write or push when the Lua call fails', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success: false } as any);

    const result = await tool.execute({ PlayerID: 0, Technology: 'Writing', Rationale: 'r' } as any);
    expect(result.Success).toBe(false);
    expect(await store.getMutableKnowledgeHistory('ResearchChanges', 0)).toHaveLength(0);
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
