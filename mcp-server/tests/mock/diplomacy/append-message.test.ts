/**
 * Tests for the append-message tool's validation + write behavior (interactive-diplomacy
 * stage 1), exercised against an in-memory KnowledgeStore — no bridge-service / DLL.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import createAppendMessageTool from '../../../src/tools/actions/append-message.js';
import createReadTranscriptTool from '../../../src/tools/knowledge/read-transcript.js';
import { getDiplomaticMessages } from '../../../src/knowledge/getters/diplomatic-messages.js';
import { getVisibility } from '../../../src/utils/knowledge/visibility.js';
import { setupDiplomacyStore, seedPlayer } from '../helpers.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { knowledgeManager } from '../../../src/server.js';
import { connectToolClient } from '../tool-client.js';

// The cache-empty branch falls back to a live Lua fetch; stub it to [] so no bridge is needed.
vi.mock('../../../src/knowledge/getters/player-information.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/knowledge/getters/player-information.js')>();
  return { ...actual, getPlayerInformations: vi.fn(async () => []) };
});

const tool = createAppendMessageTool();
const readTool = createReadTranscriptTool();
let store: KnowledgeStore;
let client: Awaited<ReturnType<typeof connectToolClient>>;

beforeEach(async () => {
  store = await setupDiplomacyStore(10);
  client = await connectToolClient(tool, readTool);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await client.close();
  await store.close();
});

/** Base happy-path args (major civs 1 and 3, seeded in most tests). */
function args(overrides: Record<string, unknown> = {}) {
  return {
    PlayerAID: 3,
    PlayerBID: 1,
    PlayerARole: 'diplomat',
    PlayerBRole: 'the leader',
    SpeakerID: 3,
    MessageType: 'text',
    Content: 'Greetings.',
    ...overrides,
  };
}

describe('append-message guards', () => {
  beforeEach(async () => {
    await seedPlayer(store, 1);
    await seedPlayer(store, 3);
  });

  it('rejects deal-accept and deal-enacted (enactment route only)', async () => {
    await expect(client.call(args({ MessageType: 'deal-accept' }))).rejects.toThrow();
    await expect(client.call(args({ MessageType: 'deal-enacted' }))).rejects.toThrow();
  });

  it('refuses deal-reject before any other validation and writes nothing', async () => {
    // Stage 7.04 moved rejection authority to reject-agent-deal so proposal state is decided
    // inside one write transaction. No caller may bypass it through the archival tool. The
    // refusal is the FIRST guard, so even a well-formed rejection of a real proposal is refused
    // just the same: the archival path can never produce a deal-reject row.
    const proposal = await client.call(
      args({ MessageType: 'deal-proposal', Payload: { Deal: { items: [] } } })
    );

    await expect(
      client.call(
        args({ MessageType: 'deal-reject', SpeakerID: 1, Payload: { ProposalMessageID: proposal.ID } })
      )
    ).rejects.toThrow();

    expect((await client.call({ PlayerAID: 1, PlayerBID: 3, MessageType: 'deal-reject' }, readTool.name)).messages).toHaveLength(0);
  });

  it('rejects equal endpoints', async () => {
    await expect(client.call(args({ PlayerAID: 3, PlayerBID: 3 }))).rejects.toThrow();
  });

  it('rejects a speaker who is not an endpoint', async () => {
    await expect(client.call(args({ SpeakerID: 9 }))).rejects.toThrow();
  });

  it('requires Payload.Deal for proposals and counters', async () => {
    await expect(client.call(args({ MessageType: 'deal-proposal' }))).rejects.toThrow();
    await expect(client.call(args({ MessageType: 'deal-counter' }))).rejects.toThrow();
  });

  it('rejects a transport append when its expected game is not active', async () => {
    vi.spyOn(knowledgeManager, 'getGameId').mockReturnValue('active-game');
    await expect(
      client.call(args({ ExpectedGameID: 'previous-game' }))
    ).rejects.toThrow();
  });

  it('rechecks the expected game after async validation before retaining the store', async () => {
    vi.spyOn(knowledgeManager, 'getGameId')
      .mockReturnValueOnce('stable-game')
      .mockReturnValue('switched-game');

    // The switched-game wording can only come from the second (post-validation) read.
    await expect(
      client.call(args({ ExpectedGameID: 'stable-game' }))
    ).rejects.toThrow();
    expect((await client.call({ PlayerAID: 1, PlayerBID: 3 }, readTool.name)).messages).toHaveLength(0);
  });
});

describe('append-message ordering & roles', () => {
  beforeEach(async () => {
    await seedPlayer(store, 1);
    await seedPlayer(store, 3);
  });

  it('orders the pair (Player1 = min) and remaps roles, stamping the server turn', async () => {
    const row = await client.call(args());
    expect(row).toMatchObject({
      Player1ID: 1,
      Player2ID: 3,
      Player1Role: 'the leader',
      Player2Role: 'diplomat',
      SpeakerID: 3,
      MessageType: 'text',
      Turn: 10,
    });

    // The row is actually persisted and readable as one ordered thread.
    const stored = await client.call({ PlayerAID: 1, PlayerBID: 3 }, readTool.name);
    expect(stored.messages).toHaveLength(1);
    expect(stored.messages[0].Content).toBe('Greetings.');
  });
});

describe('append-message observer endpoint', () => {
  it('sorts -1 to Player1, defaults its role to observer, and exempts it from the major check', async () => {
    await seedPlayer(store, 5); // only the real civ is seeded
    const row = await client.call(
      args({ PlayerAID: -1, PlayerBID: 5, PlayerARole: undefined, PlayerBRole: 'diplomat', SpeakerID: 5 })
    );
    expect(row).toMatchObject({ Player1ID: -1, Player1Role: 'observer', Player2ID: 5 });
  });

  it('accepts one real observer slot paired with a major, preserves the ordered pair, and limits visibility to the major', async () => {
    await seedPlayer(store, 5);
    const row = await client.call(
      args({ PlayerAID: 27, PlayerBID: 5, PlayerARole: 'Observer', PlayerBRole: 'diplomat', SpeakerID: 27 })
    );

    expect(row).toMatchObject({ Player1ID: 5, Player2ID: 27, Player1Role: 'diplomat', Player2Role: 'Observer' });
    const [stored] = (await getDiplomaticMessages(27, 5)).messages;
    expect(getVisibility(stored, 5)).toBe(2);
    expect(getVisibility(stored, 0)).toBe(0);
  });

  it('accepts an IN-RANGE observer slot, which is where Civ 5 actually seats an observer', async () => {
    // Civ 5 gives the observer the first free player slot, so an eight-civ game observes from
    // slot 8 — inside the major range. Classifying by slot index refused every such message.
    await seedPlayer(store, 6);
    await seedPlayer(store, 8, { isMajor: 0 });
    const row = await client.call(
      args({ PlayerAID: 8, PlayerBID: 6, PlayerARole: 'Observer', PlayerBRole: 'diplomat', SpeakerID: 8 })
    );

    expect(row).toMatchObject({ Player1ID: 6, Player2ID: 8, Player1Role: 'diplomat', Player2Role: 'Observer' });
    const [stored] = (await getDiplomaticMessages(8, 6)).messages;
    // The observer slot is an endpoint of the pair but owns no visibility column.
    expect(getVisibility(stored, 6)).toBe(2);
    expect(getVisibility(stored, 8)).toBe(0);
  });

  it('does not let a living major civilization claim the Observer exemption', async () => {
    // The role alone is not the test: a slot holding a real civ is validated as one.
    await seedPlayer(store, 5);
    await seedPlayer(store, 7, { isMajor: 0 });
    await expect(
      client.call(args({ PlayerAID: 7, PlayerBID: 5, PlayerARole: 'the leader', PlayerBRole: 'diplomat', SpeakerID: 7 }))
    ).rejects.toThrow();
    // ...and the counterpart of an observer must still be a real major civilization.
    await expect(
      client.call(args({ PlayerAID: 8, PlayerBID: 7, PlayerARole: 'Observer', PlayerBRole: 'the leader', SpeakerID: 8 }))
    ).rejects.toThrow();
  });

  it('rejects a real observer slot without a valid major counterpart', async () => {
    await expect(
      client.call(args({ PlayerAID: 27, PlayerBID: 28, PlayerARole: 'Observer', PlayerBRole: 'Observer', SpeakerID: 27 }))
    ).rejects.toThrow();
  });

  it('rejects an out-of-range endpoint whose role is not exactly Observer', async () => {
    await seedPlayer(store, 5);
    await expect(
      client.call(args({ PlayerAID: 27, PlayerBID: 5, PlayerARole: 'observer', PlayerBRole: 'diplomat', SpeakerID: 27 }))
    ).rejects.toThrow();
  });
});

describe('append-message major-civ validation', () => {
  it('rejects a non-major endpoint', async () => {
    await seedPlayer(store, 1, { isMajor: 1 });
    await seedPlayer(store, 3, { isMajor: 0 });
    await expect(client.call(args())).rejects.toThrow();
  });

  it('skips the check when PlayerInformations is empty', async () => {
    // No seeding → cache empty → stubbed fetch returns [] → check skipped, write succeeds.
    const row = await client.call(args());
    expect(row.MessageType).toBe('text');
  });
});

// The former 'append-message deal-reject referencing' suite moved to reject-agent-deal.test.ts:
// this tool no longer resolves or validates Payload.ProposalMessageID because it no longer writes
// deal-reject at all. The equivalent proposal-reference checks now run inside that tool's write
// transaction, where they cannot go stale between the lookup and the append.

describe('append-message visibility flags', () => {
  it('sets full visibility for BOTH civ endpoints on a civ↔civ row, and none for an uninvolved player', async () => {
    await seedPlayer(store, 1);
    await seedPlayer(store, 3);
    await client.call(args()); // 1 ↔ 3
    const thread = await client.call({ PlayerAID: 1, PlayerBID: 3 }, readTool.name);
    expect(thread.messages).toHaveLength(1);
    const [row] = (await getDiplomaticMessages(1, 3)).messages;
    expect(getVisibility(row, 1)).toBe(2);
    expect(getVisibility(row, 3)).toBe(2);
    expect(getVisibility(row, 2)).toBe(0); // an uninvolved civ cannot see the private transcript
  });

  it('sets visibility only for the real civ on an observer (-1) row', async () => {
    await seedPlayer(store, 5);
    await client.call(
      args({ PlayerAID: -1, PlayerBID: 5, PlayerARole: undefined, PlayerBRole: 'diplomat', SpeakerID: 5 })
    );
    const thread = await client.call({ PlayerAID: -1, PlayerBID: 5 }, readTool.name);
    expect(thread.messages[0].Content).toBe('Greetings.');
    const [row] = (await getDiplomaticMessages(-1, 5)).messages;
    expect(getVisibility(row, 5)).toBe(2);
    // The observer sentinel (-1) has no player slot; no other player gains visibility.
    expect(getVisibility(row, 0)).toBe(0);
  });
});
