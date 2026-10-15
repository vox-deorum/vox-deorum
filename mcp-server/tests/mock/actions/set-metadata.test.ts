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
import createGetMetadataTool from '../../../src/tools/knowledge/get-metadata.js';
import { connectToolClient } from '../tool-client.js';

const tool = createSetMetadataTool();
const readTool = createGetMetadataTool();
let store: KnowledgeStore;
let infoSpy: ReturnType<typeof vi.spyOn>;
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  store = await setupStore(10);
  infoSpy = vi.spyOn(playerActions, 'pushPlayerInfo').mockResolvedValue();
  client = await connectToolClient(tool, readTool);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await client.close();
  await store.close();
});

describe('set-metadata', () => {
  it('persists the key/value pair and fires no player info for an ordinary key', async () => {
    const result = await client.call({ Key: 'foo', Value: 'bar' });

    expect(result).toBe(true);
    expect(await client.call({ Key: 'foo' }, readTool.name)).toBe('bar');
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('combines model-{N} with the stored strategist-{N} and pushes player info', async () => {
    await store.setMetadata('strategist-2', 'simple-strategist');

    await client.call({ Key: 'model-2', Value: 'deepseek-r1' });

    expect(await client.call({ Key: 'model-2' }, readTool.name)).toBe('deepseek-r1');
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(2, 'deepseek-r1 / simple-strategist');
  });

  it('still sends model info when strategist metadata is absent', async () => {
    await client.call({ Key: 'model-7', Value: 'gpt' });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0][0]).toBe(7);
    expect(infoSpy.mock.calls[0][1]).toContain('gpt');
  });
});
