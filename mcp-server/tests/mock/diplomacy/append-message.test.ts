/**
 * Tests for the append-message tool's validation + write behavior (interactive-diplomacy
 * stage 1), exercised against an in-memory KnowledgeStore — no bridge-service / DLL.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import createAppendMessageTool from '../../../src/tools/actions/append-message.js';
import { getDiplomaticMessages } from '../../../src/knowledge/getters/diplomatic-messages.js';
import { setupDiplomacyStore, seedPlayer } from '../helpers.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

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
    expect(stored).toHaveLength(1);
    expect(stored[0].Content).toBe('Greetings.');
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
});
