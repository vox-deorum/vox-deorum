/**
 * @module tests/mock/web/enrichment
 *
 * Focused identity, live-turn, and assignment coverage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { contextRegistry } from '../../../../src/agents/runtime/context-registry.js';
import { sessionRegistry } from '../../../../src/agents/runtime/session-registry.js';
import type { EnvoyThread, PlayerAssignment } from '../../../../src/types/index.js';
import {
  backfillThreadIdentities,
  civIdentity,
  currentTurnOf,
  displayIdentity,
  enrichChat,
  getActiveAssignments,
  resolveHumanSeat,
} from '../../../../src/web/chat/enrichment.js';

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
});

describe('chat enrichment', () => {
  it('resolves assignments through the active session capability', () => {
    const assignments = {
      1: { strategist: 'human-strategist' },
      3: { strategist: 'simple-strategist' },
    } as Record<number, PlayerAssignment>;
    vi.spyOn(sessionRegistry, 'getActive').mockReturnValue({
      getPlayerAssignments: vi.fn(() => assignments),
    } as never);

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

  it('backfills only the missing seat identities from the cached game state', () => {
    // A thread opened before the seat had any cached game state froze `undefined` identities.
    const thread = makeThread();
    const stored = thread.player1Identity;
    thread.player2Identity = undefined;
    const context = makeContext({
      turn: 1,
      hasSession: true,
      sessionTurn: 5,
      gameStates: {
        5: {
          players: {
            '1': { Civilization: 'Fresh Rome', Leader: 'Fresh Caesar' },
            '3': { Civilization: 'Germany', Leader: 'Bismarck' },
          },
        },
      },
    });

    backfillThreadIdentities(thread, context);

    // The missing seat is filled; the present one is never overwritten.
    expect(thread.player2Identity).toEqual({ name: 'Germany', leader: 'Bismarck' });
    expect(thread.player1Identity).toBe(stored);
  });

  it('leaves the thread unchanged when the cache still has nothing to offer', () => {
    const thread = makeThread();
    thread.player1Identity = undefined;
    thread.player2Identity = undefined;

    backfillThreadIdentities(thread, makeContext({ turn: 1, hasSession: true, sessionTurn: 5 }));

    expect(thread.player1Identity).toBeUndefined();
    expect(thread.player2Identity).toBeUndefined();
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
});
