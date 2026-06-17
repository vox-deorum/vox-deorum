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

const tool = createRelayMessageTool();
let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupStore(10);
  // localizeObject needs the (uninitialized) localization DB; stub it to identity.
  vi.spyOn(gameDatabase, 'localizeObject').mockImplementation(async (o: any) => o);
  await seedPlayer(store, 0, { civilization: 'Rome' });
  await seedPlayer(store, 1, { civilization: 'Greece' });
});

afterEach(async () => {
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
  Message: 'Intelligence',
  Content: 'Greece is massing troops near our border.',
  Confidence: 7,
  Importance: 8,
  Categories: ['Military', 'Diplomacy'],
  Memo: 'They look ready to strike next turn.',
};

describe('relay-message', () => {
  it('shapes the RelayedMessage payload with resolved names and formatted fields', async () => {
    const result = await tool.execute({ ...baseArgs } as any);

    expect(result.Success).toBe(true);
    expect(result.EventID).toBeTypeOf('number');

    const { row, payload } = await readEvent();
    expect(row.Type).toBe('RelayedMessage');
    expect(payload).toMatchObject({
      ToPlayerID: 0,
      FromPlayerID: 1,
      ToPlayer: 'Rome',
      FromPlayer: 'Greece',
      Message: 'Intelligence',
      Content: baseArgs.Content,
      Confidence: '7/9',
      Importance: 8,
      Categories: ['Military', 'Diplomacy'],
      Memo: 'Our analyst: They look ready to strike next turn.',
    });
  });

  it('stores the event visible only to the receiving leader (PlayerID)', async () => {
    await tool.execute({ ...baseArgs } as any);

    const { row } = await readEvent();
    // composeVisibility([0]) => Player0 = 2, all other Player{i} = 0.
    expect(row.Player0).toBe(2);
    expect(row.Player1).toBe(0);
  });

  it('falls back to "Player N" when the referenced player is unseeded', async () => {
    const result = await tool.execute({ ...baseArgs, FromPlayerID: 4 } as any);

    expect(result.Success).toBe(true);
    const { payload } = await readEvent();
    expect(payload.FromPlayer).toBe('Player 4');
  });
});
