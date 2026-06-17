/**
 * Tests for the player-flavors getter: the Lua boundary is stubbed and the
 * flavor normalization (PascalCase keys, defaulting to 50, MCP-range values),
 * grand-strategy enum resolution, and the player-scoped mutable store-write path
 * run against a real in-memory KnowledgeStore.
 *
 * The flavor-description list and the GrandStrategy enum map are normally loaded
 * from disk / the game DB at runtime; the mock tier has neither, so we stub the
 * loader and inject the enum map directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../../helpers.js';
import { LuaFunction } from '../../../../src/bridge/lua-function.js';
import { enumMappings } from '../../../../src/utils/knowledge/enum.js';
import * as loader from '../../../../src/utils/strategies/loader.js';
import { getPlayerFlavors } from '../../../../src/knowledge/getters/player-flavors.js';
import type { KnowledgeStore } from '../../../../src/knowledge/store.js';

let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupStore(10);
  enumMappings.GrandStrategy = { 1: 'Conquest', 2: 'Culture' };
  // A small known flavor catalog so defaulting-to-50 is observable.
  vi.spyOn(loader, 'loadFlavorDescriptions').mockResolvedValue({
    Offense: 'd', Defense: 'd', Gold: 'd', Science: 'd',
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete (enumMappings as any).GrandStrategy;
  await store.close();
});

/** Stub the Lua boundary to return a canned {Flavors, GrandStrategy} payload. */
function mockLua(result: unknown, success = true) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success, result } as any);
}

describe('getPlayerFlavors', () => {
  it('returns null when the Lua call fails (no store write)', async () => {
    mockLua(undefined, false);

    expect(await getPlayerFlavors(1)).toBeNull();
    expect(await store.getMutableKnowledgeHistory('FlavorChanges', 1)).toHaveLength(0);
  });

  it('returns null when no custom flavors are set (no store write)', async () => {
    mockLua({ Flavors: {}, GrandStrategy: 1 });

    expect(await getPlayerFlavors(1)).toBeNull();
    expect(await store.getMutableKnowledgeHistory('FlavorChanges', 1)).toHaveLength(0);
  });

  it('PascalCases FLAVOR_ keys, defaults the rest to 50, resolves the grand strategy, and persists', async () => {
    mockLua({ Flavors: { FLAVOR_OFFENSE: 80, FLAVOR_GOLD: 20 }, GrandStrategy: 2 });

    const result = await getPlayerFlavors(1);
    expect(result).toMatchObject({
      Key: 1,
      Offense: 80, // explicitly set, MCP-range passthrough
      Gold: 20,
      Defense: 50, // present in catalog but unset → balanced default
      Science: 50,
      GrandStrategy: 'Culture',
    });

    const stored = await store.getMutableKnowledge('FlavorChanges', 1, 1) as any;
    expect(stored).toMatchObject({ Key: 1, Offense: 80, GrandStrategy: 'Culture' });
    expect(stored.Rationale).toMatch(/^Tweaked by In-Game AI/);
    // Visible only to player 1.
    expect(await store.getMutableKnowledge('FlavorChanges', 1, 2)).toBeUndefined();
  });

  it('falls back to "Unknown" when the grand strategy id is not in the enum map', async () => {
    mockLua({ Flavors: { FLAVOR_OFFENSE: 60 }, GrandStrategy: 999 });

    const result = await getPlayerFlavors(1);
    expect(result!.GrandStrategy).toBe('Unknown');
  });
});
