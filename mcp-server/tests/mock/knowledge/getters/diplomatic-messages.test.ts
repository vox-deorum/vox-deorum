/**
 * Complementary tests for the diplomatic-messages getters, exercised by calling
 * getDiplomaticMessages() *directly* (not through the read-transcript tool).
 *
 * orderPlayerPair, the tool-driven getDiplomaticMessages happy path / MessageType
 * / speakerRole(=Player2Role) filters, and getDiplomaticMessageById are already
 * covered by tests/mock/diplomacy/read-transcript.test.ts. This file scopes to the
 * branches that test does NOT touch:
 *   - the empty-result branch (no rows for a pair),
 *   - the speakerRole filter resolving against Player1Role (speaker == Player1ID),
 *   - combining the MessageType (SQL) and speakerRole (in-JS) filters,
 *   - the observer-sentinel (-1) pair ordering on a real read.
 * Rows are seeded straight into the store so the getter's own query path runs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../../helpers.js';
import { getDiplomaticMessages } from '../../../../src/knowledge/getters/diplomatic-messages.js';
import type { KnowledgeStore } from '../../../../src/knowledge/store.js';

let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupStore(10);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

/**
 * Seed one DiplomaticMessages row. Endpoints are passed already ordered
 * (player1 < player2) for clarity; roles/speaker drive the filter assertions.
 */
async function seedMsg(m: {
  player1ID: number;
  player2ID: number;
  speakerID: number;
  player1Role?: string;
  player2Role?: string;
  messageType?: string;
  content: string;
}): Promise<number> {
  return store.storeTimedKnowledge('DiplomaticMessages', {
    data: {
      Player1ID: m.player1ID,
      Player2ID: m.player2ID,
      Player1Role: m.player1Role ?? 'the leader',
      Player2Role: m.player2Role ?? 'diplomat',
      SpeakerID: m.speakerID,
      MessageType: m.messageType ?? 'text',
      Content: m.content,
      Payload: {},
    },
  });
}

describe('getDiplomaticMessages (direct)', () => {
  it('returns an empty page for a pair with no messages', async () => {
    expect(await getDiplomaticMessages(4, 5)).toMatchObject({ messages: [], hasMore: false });
  });

  it('orders the pair by min/max and reads identically regardless of argument order', async () => {
    await seedMsg({ player1ID: 1, player2ID: 3, speakerID: 1, content: 'A' });
    await seedMsg({ player1ID: 1, player2ID: 3, speakerID: 3, content: 'B' });

    const forward = await getDiplomaticMessages(1, 3);
    const reverse = await getDiplomaticMessages(3, 1);
    expect(forward.messages.map((m) => m.Content)).toEqual(['A', 'B']);
    expect(reverse.messages.map((m) => m.Content)).toEqual(['A', 'B']);
  });

  it('filters speakerRole against Player1Role when the speaker is Player1ID', async () => {
    // Speaker 1 == Player1ID -> role resolves to Player1Role ('the leader').
    await seedMsg({ player1ID: 1, player2ID: 3, speakerID: 1, content: 'fromLeader' });
    // Speaker 3 == Player2ID -> role resolves to Player2Role ('diplomat').
    await seedMsg({ player1ID: 1, player2ID: 3, speakerID: 3, content: 'fromDiplomat' });

    const leaderOnly = await getDiplomaticMessages(1, 3, { speakerRole: 'the leader' });
    expect(leaderOnly.messages.map((m) => m.Content)).toEqual(['fromLeader']);
  });

  it('combines the MessageType (SQL) and speakerRole (in-JS) filters', async () => {
    await seedMsg({ player1ID: 1, player2ID: 3, speakerID: 1, messageType: 'deal-proposal', content: 'leaderProposal' });
    await seedMsg({ player1ID: 1, player2ID: 3, speakerID: 3, messageType: 'deal-proposal', content: 'diplomatProposal' });
    await seedMsg({ player1ID: 1, player2ID: 3, speakerID: 1, messageType: 'text', content: 'leaderText' });

    const result = await getDiplomaticMessages(1, 3, {
      messageType: 'deal-proposal',
      speakerRole: 'the leader',
    });
    expect(result.messages.map((m) => m.Content)).toEqual(['leaderProposal']);
  });

  it('handles the observer sentinel (-1) as Player1ID of the pair', async () => {
    // Observer (-1) sorts to Player1ID; the real civ (5) is Player2ID.
    await seedMsg({ player1ID: -1, player2ID: 5, speakerID: 5, player1Role: 'observer', content: 'obs' });

    const result = await getDiplomaticMessages(5, -1);
    expect(result.messages.map((m) => m.Content)).toEqual(['obs']);
    expect(result.messages[0]).toMatchObject({ Player1ID: -1, Player2ID: 5 });
  });

  it('pages the newest raw rows in ascending order with the lowest scanned ID as cursor', async () => {
    for (const content of ['one', 'two', 'three', 'four']) {
      await seedMsg({ player1ID: 1, player2ID: 3, speakerID: 3, content });
    }

    const page = await getDiplomaticMessages(1, 3, { limit: 2 });
    expect(page.messages.map((message) => message.Content)).toEqual(['three', 'four']);
    expect(page.NextBeforeID).toBe(page.messages[0].ID);
    expect(page.hasMore).toBe(true);
  });

  it('keeps the raw scan cursor and hasMore when a role filter removes the page rows', async () => {
    await seedMsg({ player1ID: 1, player2ID: 3, speakerID: 1, content: 'leader-old' });
    await seedMsg({ player1ID: 1, player2ID: 3, speakerID: 3, content: 'diplomat-newer' });
    await seedMsg({ player1ID: 1, player2ID: 3, speakerID: 3, content: 'diplomat-newest' });

    const page = await getDiplomaticMessages(1, 3, { limit: 2, speakerRole: 'the leader' });
    expect(page.messages).toEqual([]);
    expect(page.NextBeforeID).toBeDefined();
    expect(page.hasMore).toBe(true);
  });
});
