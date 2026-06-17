/**
 * Tests for the set-flavors action tool. The Lua boundary is stubbed (no bridge); the
 * flavor-key normalization (PascalCase <-> FLAVOR_ format), clamping to 0-100, grand
 * strategy enum resolution, the FlavorChanges store write (with the full 0-100 / default-50
 * flavor set), change detection, and the replay push run for real against an in-memory
 * KnowledgeStore. Valid flavor keys come from the real docs/strategies/flavors.json.
 * The GrandStrategy enum map is injected since the mock tier has no DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import { enumMappings } from '../../../src/utils/knowledge/enum.js';
import * as playerActions from '../../../src/utils/lua/player-actions.js';
import createSetFlavorsTool from '../../../src/tools/actions/set-flavors.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createSetFlavorsTool();
let store: KnowledgeStore;
let pushSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  store = await setupStore(10);
  enumMappings.GrandStrategy = { 1: 'Conquest', 2: 'Culture' };
  pushSpy = vi.spyOn(playerActions, 'pushPlayerAction').mockResolvedValue();
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete (enumMappings as any).GrandStrategy;
  await store.close();
});

/**
 * Stub the Lua boundary so super.call() returns a canned previous flavor state.
 * Flavors are keyed in the game's FLAVOR_ format and in MCP range (0-100).
 */
function mockLua(opts: {
  changed?: boolean;
  grandStrategy?: number;
  flavors?: Record<string, number>;
}) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({
    success: true,
    result: {
      Changed: opts.changed ?? true,
      GrandStrategy: opts.grandStrategy ?? 1,
      Flavors: opts.flavors ?? {},
    },
  } as any);
}

describe('set-flavors', () => {
  it('stores the full flavor set: clamped overrides, previous values, and 50 defaults', async () => {
    // Previously Offense=80 (FLAVOR_OFFENSE) in MCP range; everything else default.
    mockLua({ flavors: { FLAVOR_OFFENSE: 80 } });

    await tool.execute({
      PlayerID: 0,
      Flavors: { Defense: 999, Science: 10 }, // 999 clamps to 100
      Rationale: 'turtle',
    } as any);

    const row = (await store.getMutableKnowledge('FlavorChanges', 0)) as any;
    expect(row).not.toBeNull();
    expect(row.Offense).toBe(80); // carried over from previous
    expect(row.Defense).toBe(100); // clamped override
    expect(row.Science).toBe(10); // override
    expect(row.Culture).toBe(50); // untouched flavor defaults to 50
    expect(row.Rationale).toBe('turtle');
    expect(row.Turn).toBe(10);
  });

  it('resolves the grand strategy enum and records the change', async () => {
    mockLua({ grandStrategy: 1 }); // previously Conquest

    await tool.execute({
      PlayerID: 0,
      GrandStrategy: 'Culture',
      Rationale: 'pivot',
    } as any);

    const row = (await store.getMutableKnowledge('FlavorChanges', 0)) as any;
    expect(row.GrandStrategy).toBe('Culture');

    const [, actionType, summary, , prefix] = pushSpy.mock.calls[0];
    expect(actionType).toBe('flavors');
    expect(prefix).toBe('AI preferences');
    expect(summary).toContain('Grand Strategy: Conquest → Culture');
  });

  it('writes FlavorChanges visible only to the acting player', async () => {
    mockLua({ flavors: {} });

    await tool.execute({ PlayerID: 0, Flavors: { Offense: 70 }, Rationale: 'r' } as any);

    expect(await store.getMutableKnowledge('FlavorChanges', 0, 0)).not.toBeUndefined();
    expect(await store.getMutableKnowledge('FlavorChanges', 0, 1)).toBeUndefined();
  });

  it('reports a flavor delta in the replay summary when a value actually changes', async () => {
    mockLua({ flavors: { FLAVOR_OFFENSE: 30 } }); // previously Offense=30

    await tool.execute({
      PlayerID: 0,
      Flavors: { Offense: 90 },
      Rationale: 'aggressive',
    } as any);

    const [, , summary, rationale, prefix] = pushSpy.mock.calls[0];
    expect(prefix).toBe('AI preferences');
    expect(rationale).toBe('aggressive');
    expect(summary).toContain('Offense: 30 → 90');
  });

  it('pushes a "No changes" event (no replay prefix) when nothing changed', async () => {
    mockLua({ flavors: { FLAVOR_OFFENSE: 70 } }); // previously Offense=70

    await tool.execute({
      PlayerID: 0,
      Flavors: { Offense: 70 }, // same value
      Rationale: 'noop',
    } as any);

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const [, , summary, , prefix] = pushSpy.mock.calls[0];
    expect(summary).toBe('No changes');
    expect(prefix).toBeUndefined(); // no replay message when nothing changed
  });

  it('ignores unknown flavor keys not present in flavors.json', async () => {
    mockLua({ flavors: {} });

    await tool.execute({
      PlayerID: 0,
      Flavors: { NotARealFlavor: 99, Offense: 70 },
      Rationale: 'r',
    } as any);

    const row = (await store.getMutableKnowledge('FlavorChanges', 0)) as any;
    expect(row.Offense).toBe(70);
    expect(row.NotARealFlavor).toBeUndefined();
  });

  it('does no store write or push when the Lua call fails', async () => {
    vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success: false } as any);

    const result = await tool.execute({ PlayerID: 0, Flavors: { Offense: 70 }, Rationale: 'r' } as any);
    expect(result.Success).toBe(false);
    expect(await store.getMutableKnowledgeHistory('FlavorChanges', 0)).toHaveLength(0);
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
