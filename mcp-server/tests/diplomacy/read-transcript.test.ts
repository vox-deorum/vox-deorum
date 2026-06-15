/**
 * Tests for the read-transcript tool and the underlying diplomatic-messages getters
 * (interactive-diplomacy stage 1), exercised against an in-memory KnowledgeStore.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import createAppendMessageTool from '../../src/tools/actions/append-message.js';
import createReadTranscriptTool from '../../src/tools/knowledge/read-transcript.js';
import {
  orderPlayerPair,
  getDiplomaticMessageById,
} from '../../src/knowledge/getters/diplomatic-messages.js';
import { setupDiplomacyStore, seedPlayer } from './helpers.js';
import type { KnowledgeStore } from '../../src/knowledge/store.js';

const append = createAppendMessageTool();
const read = createReadTranscriptTool();
let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupDiplomacyStore(10);
  await seedPlayer(store, 1);
  await seedPlayer(store, 2);
  await seedPlayer(store, 3);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

/** Append one message via the tool; returns its append ID. */
async function appendMsg(a: Record<string, unknown>): Promise<number> {
  const row = await append.execute({
    PlayerARole: 'the leader',
    PlayerBRole: 'diplomat',
    Content: 'msg',
    MessageType: 'text',
    ...a,
  } as any);
  return row.ID;
}

describe('orderPlayerPair', () => {
  it('orders min/max and sorts the observer (-1) first, independent of argument order', () => {
    expect(orderPlayerPair(3, 1)).toEqual({ player1ID: 1, player2ID: 3 });
    expect(orderPlayerPair(1, 3)).toEqual({ player1ID: 1, player2ID: 3 });
    expect(orderPlayerPair(5, -1)).toEqual({ player1ID: -1, player2ID: 5 });
  });
});

describe('read-transcript', () => {
  beforeEach(async () => {
    // pair 1↔3: speaker 3 (diplomat role), then speaker 1 (the leader role), then a proposal
    await appendMsg({ PlayerAID: 1, PlayerBID: 3, SpeakerID: 3, Content: 'A' });
    await appendMsg({ PlayerAID: 1, PlayerBID: 3, SpeakerID: 1, Content: 'B' });
    await appendMsg({ PlayerAID: 1, PlayerBID: 3, SpeakerID: 3, MessageType: 'deal-proposal', Payload: { Deal: { items: [] } }, Content: 'deal' });
    // pair 2↔3: one message
    await appendMsg({ PlayerAID: 2, PlayerBID: 3, SpeakerID: 2, Content: 'other-pair' });
  });

  it('returns only the requested pair, ordered by ID, regardless of argument order', async () => {
    const forward = await read.execute({ PlayerAID: 1, PlayerBID: 3 } as any);
    const reverse = await read.execute({ PlayerAID: 3, PlayerBID: 1 } as any);

    expect(forward.map((m) => m.Content)).toEqual(['A', 'B', 'deal']);
    expect(reverse.map((m) => m.Content)).toEqual(['A', 'B', 'deal']);
    // The other pair's message is excluded.
    expect(forward.every((m) => m.Content !== 'other-pair')).toBe(true);
  });

  it('filters by MessageType (pushed to SQL)', async () => {
    const texts = await read.execute({ PlayerAID: 1, PlayerBID: 3, MessageType: 'text' } as any);
    expect(texts.map((m) => m.Content)).toEqual(['A', 'B']);
  });

  it('filters by speaker Role (applied per row)', async () => {
    const byDiplomat = await read.execute({ PlayerAID: 1, PlayerBID: 3, Role: 'diplomat' } as any);
    // Only messages whose speaker (3) holds the diplomat role.
    expect(byDiplomat.map((m) => m.Content)).toEqual(['A', 'deal']);
  });

  it('projects the public message shape (Payload/Turn/CreatedAt, no PlayerN columns)', async () => {
    const [first] = await read.execute({ PlayerAID: 1, PlayerBID: 3 } as any);
    expect(first).toHaveProperty('Payload');
    expect(first).toHaveProperty('Turn', 10);
    expect(first).toHaveProperty('CreatedAt');
    expect(first).not.toHaveProperty('Player0');
    expect(first).not.toHaveProperty('Player1');
  });
});

describe('getDiplomaticMessageById', () => {
  it('returns the row on hit and undefined on miss', async () => {
    const id = await appendMsg({ PlayerAID: 1, PlayerBID: 3, SpeakerID: 3, Content: 'findme' });
    const found = await getDiplomaticMessageById(id);
    expect(found?.Content).toBe('findme');
    expect(await getDiplomaticMessageById(99999)).toBeUndefined();
  });
});
