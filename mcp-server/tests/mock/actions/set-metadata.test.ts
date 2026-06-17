/**
 * Tests for the set-metadata action tool. The metadata write runs for real
 * against an in-memory KnowledgeStore; only the Lua-boundary player-info push is
 * stubbed. Covers the plain key/value write plus the special "model-{N}" key,
 * which combines the value with the stored "strategist-{N}" and fires a player
 * info event.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../helpers.js';
import * as playerActions from '../../../src/utils/lua/player-actions.js';
import createSetMetadataTool from '../../../src/tools/actions/set-metadata.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const tool = createSetMetadataTool();
let store: KnowledgeStore;
let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  store = await setupStore(10);
  infoSpy = vi.spyOn(playerActions, 'pushPlayerInfo').mockResolvedValue();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

describe('set-metadata', () => {
  it('persists the key/value pair and fires no player info for an ordinary key', async () => {
    const result = await tool.execute({ Key: 'foo', Value: 'bar' } as any);

    expect(result).toBe(true);
    expect(await store.getMetadata('foo')).toBe('bar');
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('combines model-{N} with the stored strategist-{N} and pushes player info', async () => {
    await store.setMetadata('strategist-2', 'simple-strategist');

    await tool.execute({ Key: 'model-2', Value: 'deepseek-r1' } as any);

    expect(await store.getMetadata('model-2')).toBe('deepseek-r1');
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(2, 'deepseek-r1 / simple-strategist');
  });

  it("falls back to 'unknown' when no strategist-{N} is stored", async () => {
    await tool.execute({ Key: 'model-7', Value: 'gpt' } as any);

    expect(infoSpy).toHaveBeenCalledWith(7, 'gpt / unknown');
  });
});
