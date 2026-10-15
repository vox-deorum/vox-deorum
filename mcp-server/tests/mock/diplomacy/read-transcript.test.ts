/**
 * Tests for the read-transcript tool and the underlying diplomatic-messages getters
 * (interactive-diplomacy stage 1), exercised against an in-memory KnowledgeStore.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import createAppendMessageTool from '../../../src/tools/actions/append-message.js';
import createReadTranscriptTool from '../../../src/tools/knowledge/read-transcript.js';
import { getDiplomaticMessageById } from '../../../src/knowledge/getters/diplomatic-messages.js';
import { setupDiplomacyStore, seedPlayer } from '../helpers.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { connectToolClient } from '../tool-client.js';

const append = createAppendMessageTool();
const read = createReadTranscriptTool();
let store: KnowledgeStore;
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  store = await setupDiplomacyStore(10);
  await seedPlayer(store, 1);
  await seedPlayer(store, 2);
  await seedPlayer(store, 3);
  client = await connectToolClient(append, read);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await client.close();
  await store.close();
});

/** Append one message via the tool; returns its append ID. */
async function appendMsg(a: Record<string, unknown>): Promise<number> {
  const row = await client.call({
    PlayerARole: 'the leader',
    PlayerBRole: 'diplomat',
    Content: 'msg',
    MessageType: 'text',
    ...a,
  }, append.name);
  return row.ID;
}

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
    const forward = (await client.call({ PlayerAID: 1, PlayerBID: 3 }, read.name)).messages;
    const reverse = (await client.call({ PlayerAID: 3, PlayerBID: 1 }, read.name)).messages;

    expect(forward.map((m) => m.Content)).toEqual(['A', 'B', 'deal']);
    expect(reverse.map((m) => m.Content)).toEqual(['A', 'B', 'deal']);
    // The other pair's message is excluded.
    expect(forward.every((m) => m.Content !== 'other-pair')).toBe(true);
  });

  it('filters by MessageType (pushed to SQL)', async () => {
    const texts = (await client.call({ PlayerAID: 1, PlayerBID: 3, MessageType: 'text' }, read.name)).messages;
    expect(texts.map((m) => m.Content)).toEqual(['A', 'B']);
  });

  it('filters by speaker Role (applied per row)', async () => {
    const byDiplomat = (await client.call({ PlayerAID: 1, PlayerBID: 3, Role: 'diplomat' }, read.name)).messages;
    // Only messages whose speaker (3) holds the diplomat role.
    expect(byDiplomat.map((m) => m.Content)).toEqual(['A', 'deal']);
  });

  it('projects the public message shape (Payload/Turn/CreatedAt, no PlayerN columns)', async () => {
    const [first] = (await client.call({ PlayerAID: 1, PlayerBID: 3 }, read.name)).messages;
    expect(first).toHaveProperty('Payload');
    expect(first).toHaveProperty('Turn', 10);
    expect(first).toHaveProperty('CreatedAt');
    expect(first).not.toHaveProperty('Player0');
    expect(first).not.toHaveProperty('Player1');
  });

  it('exposes raw-scan paging metadata through the tool', async () => {
    const page = await client.call({ PlayerAID: 1, PlayerBID: 3, Limit: 2 }, read.name);

    expect(page.messages.map((message) => message.Content)).toEqual(['B', 'deal']);
    expect(page).toMatchObject({ hasMore: true, NextBeforeID: page.messages[0].ID });
  });

  it('advances the raw cursor when a role-filtered page has no visible messages', async () => {
    await appendMsg({ PlayerAID: 1, PlayerBID: 3, SpeakerID: 1, Content: 'Leader reply one' });
    await appendMsg({ PlayerAID: 1, PlayerBID: 3, SpeakerID: 1, Content: 'Leader reply two' });

    const emptyPage = await client.call({ PlayerAID: 1, PlayerBID: 3, Role: 'diplomat', Limit: 2 }, read.name);
    const rawPage = await client.call({ PlayerAID: 1, PlayerBID: 3, Limit: 2 }, read.name);

    expect(emptyPage.messages).toEqual([]);
    expect(emptyPage.hasMore).toBe(true);
    expect(emptyPage.NextBeforeID).toBe(rawPage.NextBeforeID);

    const nextPage = await client.call({
      PlayerAID: 1,
      PlayerBID: 3,
      Role: 'diplomat',
      Limit: 2,
      BeforeID: emptyPage.NextBeforeID,
    }, read.name);
    expect(nextPage.messages.map((message: any) => message.Content)).toEqual(['deal']);
    expect(nextPage.NextBeforeID).toBeLessThan(emptyPage.NextBeforeID);
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
