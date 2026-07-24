/**
 * Tests for the append-message tool's validation + write behavior (interactive-diplomacy
 * stage 1), exercised against an in-memory KnowledgeStore — no bridge-service / DLL.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import createAppendMessageTool from '../../../src/tools/actions/append-message.js';
import { getDiplomaticMessages } from '../../../src/knowledge/getters/diplomatic-messages.js';
import { getVisibility } from '../../../src/utils/knowledge/visibility.js';
import { setupDiplomacyStore, seedPlayer } from '../helpers.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';
import { knowledgeManager } from '../../../src/server.js';

// The cache-empty branch falls back to a live Lua fetch; stub it to [] so no bridge is needed.
vi.mock('../../../src/knowledge/getters/player-information.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/knowledge/getters/player-information.js')>();
  return { ...actual, getPlayerInformations: vi.fn(async () => []) };
});

const tool = createAppendMessageTool();
let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupDiplomacyStore(10);
});

afterEach(async () => {
  vi.restoreAllMocks();
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
    await expect(tool.execute(args({ MessageType: 'deal-accept' }) as any)).rejects.toThrow(/enactment route/);
    await expect(tool.execute(args({ MessageType: 'deal-enacted' }) as any)).rejects.toThrow(/enactment route/);
  });

  it('rejects equal endpoints', async () => {
    await expect(tool.execute(args({ PlayerAID: 3, PlayerBID: 3 }) as any)).rejects.toThrow(/must be distinct/);
  });

  it('rejects a speaker who is not an endpoint', async () => {
    await expect(tool.execute(args({ SpeakerID: 9 }) as any)).rejects.toThrow(/must be one of the two endpoints/);
  });

  it('requires Payload.Deal for proposals and counters', async () => {
    await expect(tool.execute(args({ MessageType: 'deal-proposal' }) as any)).rejects.toThrow(/Payload.Deal/);
    await expect(tool.execute(args({ MessageType: 'deal-counter' }) as any)).rejects.toThrow(/Payload.Deal/);
  });

  it('rejects a transport append when its expected game is not active', async () => {
    vi.spyOn(knowledgeManager, 'getGameId').mockReturnValue('active-game');
    await expect(
      tool.execute(args({ ExpectedGameID: 'previous-game' }) as any)
    ).rejects.toThrow(/expected game previous-game, but active game is active-game/);
  });

  it('rechecks the expected game after async validation before retaining the store', async () => {
    const gameID = vi.spyOn(knowledgeManager, 'getGameId')
      .mockReturnValueOnce('stable-game')
      .mockReturnValue('switched-game');

    await expect(
      tool.execute(args({ ExpectedGameID: 'stable-game' }) as any)
    ).rejects.toThrow(/expected game stable-game, but active game is switched-game/);
    expect(gameID).toHaveBeenCalledTimes(2);
    expect((await getDiplomaticMessages(1, 3)).messages).toHaveLength(0);
  });
});

describe('append-message ordering & roles', () => {
  beforeEach(async () => {
    await seedPlayer(store, 1);
    await seedPlayer(store, 3);
  });

  it('orders the pair (Player1 = min) and remaps roles, stamping the server turn', async () => {
    const row = await tool.execute(args() as any);
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
    const stored = await getDiplomaticMessages(1, 3);
    expect(stored.messages).toHaveLength(1);
    expect(stored.messages[0].Content).toBe('Greetings.');
  });
});

describe('append-message observer endpoint', () => {
  it('sorts -1 to Player1, defaults its role to observer, and exempts it from the major check', async () => {
    await seedPlayer(store, 5); // only the real civ is seeded
    const row = await tool.execute(
      args({ PlayerAID: -1, PlayerBID: 5, PlayerARole: undefined, PlayerBRole: 'diplomat', SpeakerID: 5 }) as any
    );
    expect(row).toMatchObject({ Player1ID: -1, Player1Role: 'observer', Player2ID: 5 });
  });

  it('accepts one real observer slot paired with a major, preserves the ordered pair, and limits visibility to the major', async () => {
    await seedPlayer(store, 5);
    const row = await tool.execute(
      args({ PlayerAID: 27, PlayerBID: 5, PlayerARole: 'Observer', PlayerBRole: 'diplomat', SpeakerID: 27 }) as any
    );

    expect(row).toMatchObject({ Player1ID: 5, Player2ID: 27, Player1Role: 'diplomat', Player2Role: 'Observer' });
    const [stored] = (await getDiplomaticMessages(27, 5)).messages;
    expect(getVisibility(stored, 5)).toBe(2);
    expect(getVisibility(stored, 0)).toBe(0);
  });

  it('rejects a real observer slot without a valid major counterpart', async () => {
    await expect(
      tool.execute(args({ PlayerAID: 27, PlayerBID: 28, PlayerARole: 'Observer', PlayerBRole: 'Observer', SpeakerID: 27 }) as any)
    ).rejects.toThrow(/real observer endpoint/);
  });

  it('rejects an out-of-range endpoint whose role is not exactly Observer', async () => {
    await seedPlayer(store, 5);
    await expect(
      tool.execute(args({ PlayerAID: 27, PlayerBID: 5, PlayerARole: 'observer', PlayerBRole: 'diplomat', SpeakerID: 27 }) as any)
    ).rejects.toThrow(/exact Observer role/);
  });
});

describe('append-message major-civ validation', () => {
  it('rejects a non-major endpoint', async () => {
    await seedPlayer(store, 1, { isMajor: 1 });
    await seedPlayer(store, 3, { isMajor: 0 });
    await expect(tool.execute(args() as any)).rejects.toThrow(/not a major civilization/);
  });

  it('skips the check when PlayerInformations is empty', async () => {
    // No seeding → cache empty → stubbed fetch returns [] → check skipped, write succeeds.
    const row = await tool.execute(args() as any);
    expect(row.MessageType).toBe('text');
  });
});

describe('append-message deal-reject referencing', () => {
  beforeEach(async () => {
    await seedPlayer(store, 1);
    await seedPlayer(store, 3);
  });

  /** Append a deal-proposal in the 1↔3 pair and return its append ID. */
  async function seedProposal(): Promise<number> {
    const row = await tool.execute(args({ MessageType: 'deal-proposal', Payload: { Deal: { items: [] } } }) as any);
    return row.ID;
  }

  it('requires a numeric Payload.ProposalMessageID', async () => {
    await expect(tool.execute(args({ MessageType: 'deal-reject' }) as any)).rejects.toThrow(/ProposalMessageID/);
  });

  it('rejects a reference to a non-existent message', async () => {
    await expect(
      tool.execute(args({ MessageType: 'deal-reject', Payload: { ProposalMessageID: 9999 } }) as any)
    ).rejects.toThrow(/does not exist/);
  });

  it('rejects a reference to a message in a different conversation', async () => {
    await seedPlayer(store, 2);
    // Proposal lives in the 1↔3 pair...
    const proposalId = await seedProposal();
    // ...but the reject is filed in the 2↔3 pair.
    await expect(
      tool.execute(
        args({ PlayerAID: 2, PlayerBID: 3, PlayerARole: 'the leader', SpeakerID: 3, MessageType: 'deal-reject', Payload: { ProposalMessageID: proposalId } }) as any
      )
    ).rejects.toThrow(/not part of this conversation/);
  });

  it('rejects a reference to a non-proposal message', async () => {
    const textRow = await tool.execute(args() as any); // a plain text message
    await expect(
      tool.execute(args({ MessageType: 'deal-reject', Payload: { ProposalMessageID: textRow.ID } }) as any)
    ).rejects.toThrow(/not a deal-proposal or deal-counter/);
  });

  it('accepts a reject that references a real in-pair proposal', async () => {
    const proposalId = await seedProposal();
    const row = await tool.execute(
      args({ MessageType: 'deal-reject', SpeakerID: 1, Payload: { ProposalMessageID: proposalId } }) as any
    );
    expect(row.MessageType).toBe('deal-reject');
  });

  it('accepts a reject spoken by the original proposer (a retraction, not just a counterparty decline)', async () => {
    // seedProposal authors the proposal as SpeakerID 3; the proposer retracts it themselves.
    const proposalId = await seedProposal();
    const row = await tool.execute(
      args({ MessageType: 'deal-reject', SpeakerID: 3, Payload: { ProposalMessageID: proposalId } }) as any
    );
    expect(row.MessageType).toBe('deal-reject');
    expect(row.SpeakerID).toBe(3);
  });
});

describe('append-message visibility flags', () => {
  it('sets full visibility for BOTH civ endpoints on a civ↔civ row, and none for an uninvolved player', async () => {
    await seedPlayer(store, 1);
    await seedPlayer(store, 3);
    await tool.execute(args() as any); // 1 ↔ 3
    const [row] = (await getDiplomaticMessages(1, 3)).messages;
    expect(getVisibility(row, 1)).toBe(2);
    expect(getVisibility(row, 3)).toBe(2);
    expect(getVisibility(row, 2)).toBe(0); // an uninvolved civ cannot see the private transcript
  });

  it('sets visibility only for the real civ on an observer (-1) row', async () => {
    await seedPlayer(store, 5);
    await tool.execute(
      args({ PlayerAID: -1, PlayerBID: 5, PlayerARole: undefined, PlayerBRole: 'diplomat', SpeakerID: 5 }) as any
    );
    const [row] = (await getDiplomaticMessages(-1, 5)).messages;
    expect(getVisibility(row, 5)).toBe(2);
    // The observer sentinel (-1) has no player slot; no other player gains visibility.
    expect(getVisibility(row, 0)).toBe(0);
  });
});
