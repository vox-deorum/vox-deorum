/**
 * @module tests/mock/web/enrichment
 *
 * Focused identity, live-turn, assignment, and best-effort deal refresh coverage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reconcileDealRows: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../../src/utils/diplomacy/deal.js', () => ({
  reconcileDealRows: mocks.reconcileDealRows,
}));

vi.mock('../../../src/utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: mocks.logError,
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { contextRegistry } from '../../../src/infra/context-registry.js';
import { sessionRegistry } from '../../../src/infra/session-registry.js';
import { StrategistSession } from '../../../src/strategist/strategist-session.js';
import type { EnvoyThread, PlayerAssignment } from '../../../src/types/index.js';
import {
  civIdentity,
  currentTurnOf,
  displayIdentity,
  enrichChat,
  getActiveAssignments,
  mirrorDealRowsBestEffort,
  resolveHumanSeat,
} from '../../../src/web/chat/enrichment.js';

/** Build a minimal thread with stable identities on both ordered endpoints. */
function makeThread(): EnvoyThread {
  return {
    id: 'dipl:game-1:1:3',
    agent: 3,
    gameID: 'game-1',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'diplomat',
    player1Identity: { name: 'Rome', leader: 'Caesar' },
    player2Identity: { name: 'Germany', leader: 'Bismarck' },
    diplomacy: true,
    contextType: 'live',
    contextId: 'game-1-player-3',
    messages: [],
  };
}

/** Build a context-shaped object for enrichment tests without opening real resources. */
function makeContext(options: {
  turn?: number;
  sessionTurn?: number;
  hasSession?: boolean;
  gameStates?: Record<number, unknown>;
} = {}) {
  const parameters = {
    turn: options.turn,
    gameStates: options.gameStates ?? {},
  };
  return {
    session: options.hasSession
      ? { getTurn: () => options.sessionTurn }
      : undefined,
    getBaseParameters: () => parameters,
  } as any;
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.reconcileDealRows.mockReset();
  mocks.logError.mockReset();
});

describe('chat enrichment', () => {
  it('resolves assignments only from an active strategist session', () => {
    const assignments = {
      1: { strategist: 'human-strategist' },
      3: { strategist: 'simple-strategist' },
    } as Record<number, PlayerAssignment>;
    const session = Object.create(StrategistSession.prototype) as StrategistSession;
    session.getPlayerAssignments = vi.fn(() => assignments);
    vi.spyOn(sessionRegistry, 'getActive').mockReturnValue(session);

    expect(getActiveAssignments()).toBe(assignments);
    expect(resolveHumanSeat(assignments)).toBe(1);
    expect(resolveHumanSeat(undefined)).toBeUndefined();
  });

  it('uses the session turn verbatim and only falls back for sessionless contexts', () => {
    expect(currentTurnOf(makeContext({ turn: 5, hasSession: true, sessionTurn: 8 }))).toBe(8);
    expect(currentTurnOf(makeContext({ turn: 5, hasSession: true }))).toBeUndefined();
    expect(currentTurnOf(makeContext({ turn: 5 }))).toBe(5);
    expect(currentTurnOf(undefined)).toBeUndefined();
  });

  it('resolves civilization identity from the latest state at or before the live turn', () => {
    const context = makeContext({
      turn: 1,
      hasSession: true,
      sessionTurn: 5,
      gameStates: {
        5: { players: { '3': { Civilization: 'Germany', Leader: 'Bismarck' } } },
        6: { players: { '3': { Civilization: 'Future Germany', Leader: 'Future Leader' } } },
      },
    });

    expect(civIdentity(context, 3)).toEqual({ name: 'Germany', leader: 'Bismarck' });
    expect(civIdentity(context, -1)).toBeUndefined();
    expect(displayIdentity({ name: 'Germany', leader: 'Bismarck' })).toBe('Bismarck of Germany');
    expect(displayIdentity({ name: 'an observer', leader: '' })).toBe('an observer');
  });

  it('enriches from stored identities while reading only the current turn from context', () => {
    const thread = makeThread();
    vi.spyOn(contextRegistry, 'get').mockReturnValue(
      makeContext({ turn: 1, hasSession: true, sessionTurn: 9 }),
    );

    expect(enrichChat(thread)).toEqual({
      currentTurn: 9,
      voicedID: 3,
      voicedCiv: 'Bismarck of Germany',
      audienceCiv: 'Caesar of Rome',
    });
  });

  it('logs and swallows deal reconciliation failures after a committed write', async () => {
    const thread = makeThread();
    const failure = new Error('read failed');
    mocks.reconcileDealRows.mockRejectedValueOnce(failure);

    await expect(mirrorDealRowsBestEffort(thread)).resolves.toBeUndefined();
    expect(mocks.reconcileDealRows).toHaveBeenCalledWith(thread);
    expect(mocks.logError).toHaveBeenCalledWith(
      'Failed to mirror deal rows into the live cache after a committed write',
      { error: failure },
    );
  });
});
