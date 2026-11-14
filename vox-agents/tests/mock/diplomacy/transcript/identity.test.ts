/**
 * Unit tests for the Envoy identity helpers (getSelfIdentity / formatUserDescription).
 * Identity is resolved once at thread-open time and stored on the
 * EnvoyThread (player1Identity / player2Identity) — never re-fetched from live game state.
 * The identityOf selector those helpers use is exercised through them.
 */

import { describe, it, expect } from 'vitest';
import { agentRegistry } from '../../../../src/agents/runtime/agent-registry.js';
import type { EnvoyThread } from '../../../../src/types/index.js';

// Resolve through the registry (the canonical load entry) to avoid the circular-import
// hazard of importing a single agent module in isolation. The helpers are protected, so
// access them through a loosely-typed handle in tests.
const diplomat = agentRegistry.get('diplomat') as any;

/** Germany(3) ↔ Rome(1) thread; the agent voices seat 3, the audience is seat 1. */
function thread(partial: Partial<EnvoyThread> = {}): EnvoyThread {
  return {
    id: 'dipl:g:1:3',
    agent: 3,
    gameID: 'g',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'diplomat',
    player1Identity: { name: 'Rome', leader: 'Caesar' },
    player2Identity: { name: 'Germany', leader: 'Bismarck' },
    contextType: 'live',
    contextId: 'g-player-3',
    messages: [],
    ...partial,
  };
}

describe('getSelfIdentity', () => {
  it('reads the voiced seat (input.agent) from the thread', () => {
    expect(diplomat.getSelfIdentity(thread())).toEqual({ name: 'Germany', leader: 'Bismarck' });
  });

  it('falls back to Unknown when the voiced seat has no stored identity', () => {
    expect(diplomat.getSelfIdentity(thread({ player2Identity: undefined })))
      .toEqual({ name: 'Unknown', leader: 'Unknown' });
  });
});

describe('formatUserDescription', () => {
  it('combines the audience role with its civ ("the leader of Rome")', () => {
    expect(diplomat.formatUserDescription(thread())).toBe('the leader of Rome');
  });

  it('falls back to the civ alone when the role is unknown', () => {
    expect(diplomat.formatUserDescription(thread({ player1Role: undefined })))
      .toBe('a representative of Rome');
  });

  it('falls back to the observer when the audience civ identity is missing', () => {
    // Only the human caller opens a conversation, and the observer paths carry no civ identity by
    // design, so a missing audience civ is the observer — never a reason to fail the turn.
    expect(diplomat.formatUserDescription(thread({ player1Identity: undefined })))
      .toBe('the Observer');
  });

  it('drops the free-form role when the civ is missing (never a roleless "the leader")', () => {
    expect(diplomat.formatUserDescription(thread({ player1Role: undefined, player1Identity: undefined })))
      .toBe('the Observer');
    expect(diplomat.formatUserDescription(thread({ player1Role: 'the leader', player1Identity: undefined })))
      .toBe('the Observer');
  });
});
