/**
 * Tests for the relay-message dynamic-event tool. The payload shaping, player-name
 * resolution (from seeded PlayerInformations), visibility, and the GameEvents
 * store write all run for real against an in-memory KnowledgeStore. Only
 * gameDatabase.localizeObject (which needs the absent localization DB) is stubbed
 * to identity, mirroring the store tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore, seedPlayer } from '../helpers.js';
import { gameDatabase } from '../../../src/server.js';
import createRelayMessageTool from '../../../src/tools/actions/relay-message.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { connectToolClient } from '../tool-client.js';

const tool = createRelayMessageTool();
let store: KnowledgeStore;
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  store = await setupStore(10);
  // localizeObject needs the (uninitialized) localization DB; stub it to identity.
  vi.spyOn(gameDatabase, 'localizeObject').mockImplementation(async (o: any) => o);
  await seedPlayer(store, 0, { civilization: 'Rome', leader: 'Augustus Caesar' });
  await seedPlayer(store, 1, { civilization: 'Greece', leader: 'Alexander' });
  await seedPlayer(store, 2, { civilization: 'Egypt', leader: 'Ramesses II' });
  client = await connectToolClient(tool);
});

afterEach(async () => {
  await client.close();
  vi.restoreAllMocks();
  await store.close();
});

/** Read the single GameEvents row back, parsing its JSON payload. */
async function readEvent() {
  const rows = await store.getDatabase().selectFrom('GameEvents').selectAll().execute();
  expect(rows).toHaveLength(1);
  const row = rows[0] as any;
  const payload = typeof row.Payload === 'string' ? JSON.parse(row.Payload) : row.Payload;
  return { row, payload };
}

const baseArgs = {
  PlayerID: 0,
  FromPlayerID: 1,
  AboutPlayerIDs: [1],
  Message: 'Intelligence',
  Content: 'Greece is massing troops near our border.',
  Confidence: 7,
  Importance: 8,
  Categories: ['Military', 'Diplomacy'],
  Memo: 'They look ready to strike next turn.',
};

describe('relay-message', () => {
  it('shapes the RelayedMessage payload with resolved names and formatted fields', async () => {
    const result = await client.call({ ...baseArgs });

    expect(result.Success).toBe(true);
    expect(result.EventID).toBeTypeOf('number');

    const { row, payload } = await readEvent();
    expect(row.Type).toBe('RelayedMessage');
    expect(payload).toMatchObject({
      ToPlayerID: 0,
      FromPlayerID: 1,
      ToPlayer: 'Rome',
      FromPlayer: 'Greece',
      AboutPlayerIDs: [1],
      Message: 'Intelligence',
      Content: baseArgs.Content,
      Confidence: '7/9',
      Importance: 8,
      Categories: ['Military', 'Diplomacy'],
      Memo: 'Our analyst: They look ready to strike next turn.',
    });
  });

  it('stores the event visible only to the receiving leader (PlayerID)', async () => {
    await client.call({ ...baseArgs });

    const { row } = await readEvent();
    // composeVisibility([0]) => Player0 = 2, all other Player{i} = 0.
    expect(row.Player0).toBe(2);
    expect(row.Player1).toBe(0);
  });

  it('falls back to "Player N" when the referenced player is unseeded', async () => {
    const result = await client.call({ ...baseArgs, FromPlayerID: 4 });

    expect(result.Success).toBe(true);
    const { payload } = await readEvent();
    expect(payload.FromPlayer).toBe('Player 4');
  });

  it('stores deduplicated subject IDs separately from the memo and supports multi-category rumors', async () => {
    const result = await client.call({
      ...baseArgs, AboutPlayerIDs: [2, 2],
      Message: 'Rumor', Categories: ['Diplomacy', 'Military', 'Economy', 'Others']
    });
    expect(result.Success).toBe(true);
    const { payload } = await readEvent();
    expect(payload).toMatchObject({
      FromPlayerID: 1, FromPlayer: 'Greece', AboutPlayerIDs: [2],
      Message: 'Rumor', Categories: ['Diplomacy', 'Military', 'Economy', 'Others']
    });
    expect(payload.Memo).toBe(`Our analyst: ${baseArgs.Memo}`);
  });

  it('preserves an explicit empty subject list and defaults omitted subjects to empty', async () => {
    await client.call({ ...baseArgs, AboutPlayerIDs: [] });
    expect((await readEvent()).payload.AboutPlayerIDs).toEqual([]);
    await store.getDatabase().deleteFrom('GameEvents').execute();
    const { AboutPlayerIDs: _, ...args } = baseArgs;
    await client.call(args);
    expect((await readEvent()).payload.AboutPlayerIDs).toEqual([]);
  });

  it('accepts 4000 characters and no qualifying categories, but rejects longer content', async () => {
    expect((await client.call({ ...baseArgs, Content: 'x'.repeat(4000), Categories: [] })).Success).toBe(true);
    expect((await readEvent()).payload.Content).toHaveLength(4000);
    await expect(client.call({ ...baseArgs, Content: 'x'.repeat(4001) })).rejects.toThrow();
  });

  it('rejects unsupported report categories through MCP schema validation', async () => {
    await expect(client.call({ ...baseArgs, Categories: ['Economic'] })).rejects.toThrow();
    expect(await store.getDatabase().selectFrom('GameEvents').selectAll().execute()).toEqual([]);
  });

  it('requires the source player ID', async () => {
    const { FromPlayerID: _, ...args } = baseArgs;
    await expect(client.call(args)).rejects.toThrow();
    expect(await store.getDatabase().selectFrom('GameEvents').selectAll().execute()).toEqual([]);
  });

  it('rejects subjects that are not valid major player IDs', async () => {
    for (const AboutPlayerIDs of [['Egypt'], [-1], [99], [1.5]]) {
      await expect(client.call({ ...baseArgs, AboutPlayerIDs })).rejects.toThrow();
    }
    expect(await store.getDatabase().selectFrom('GameEvents').selectAll().execute()).toEqual([]);
  });
});
