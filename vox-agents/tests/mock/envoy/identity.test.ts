/**
 * Unit tests for the Envoy identity helpers (getSelfIdentity / formatUserDescription) and the
 * identityOf transcript util. Identity is resolved once at thread-open time and stored on the
 * EnvoyThread (player1Identity / player2Identity) — never re-fetched from live game state.
 */

import { describe, it, expect } from 'vitest';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { identityOf } from '../../../src/utils/diplomacy/transcript-utils.js';
import type { EnvoyThread } from '../../../src/types/index.js';

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

describe('identityOf', () => {
  it('returns the stored identity for either seat', () => {
    expect(identityOf(thread(), 1)).toEqual({ name: 'Rome', leader: 'Caesar' });
    expect(identityOf(thread(), 3)).toEqual({ name: 'Germany', leader: 'Bismarck' });
  });

  it('returns undefined when the seat has no stored identity', () => {
    expect(identityOf(thread({ player1Identity: undefined }), 1)).toBeUndefined();
  });
});

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

  it('throws when the audience civ identity is missing (corrupted thread state)', () => {
    expect(() => diplomat.formatUserDescription(thread({ player1Identity: undefined })))
      .toThrow(/no civ identity/);
  });

  it('throws when neither role nor civ is known', () => {
    expect(() => diplomat.formatUserDescription(thread({ player1Role: undefined, player1Identity: undefined })))
      .toThrow(/no civ identity/);
  });
});
