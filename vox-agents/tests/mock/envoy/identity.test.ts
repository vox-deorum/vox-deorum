/**
 * Unit tests for the Envoy identity helpers (getParticipantIdentity / getSelfIdentity).
 * Identity is derived from the typed parameters — live game state for LiveEnvoy subclasses,
 * the telemetry-db fields for the telepathist — never from EnvoyThread.agent.
 */

import { describe, it, expect } from 'vitest';
import { agentRegistry } from '../../../src/infra/agent-registry.js';

// Resolve through the registry (the canonical load entry) to avoid the circular-import
// hazard of importing a single agent module in isolation. The helpers are protected, so
// access them through a loosely-typed handle in tests.
const diplomat = agentRegistry.get('diplomat') as any;
const telepathist = agentRegistry.get('talkative-telepathist') as any;

describe('Envoy identity helpers', () => {
  describe('LiveEnvoy (Diplomat)', () => {
    it('should read the self seat from metadata.YouAre', () => {
      const params = { playerID: 3, metadata: { YouAre: { Name: 'Germany', Leader: 'Bismarck' } }, gameStates: {} };
      expect(diplomat.getParticipantIdentity(params, 3)).toEqual({ name: 'Germany', leader: 'Bismarck' });
      expect(diplomat.getSelfIdentity(params)).toEqual({ name: 'Germany', leader: 'Bismarck' });
    });

    it('should read another visible player from the recent game state', () => {
      const params = {
        playerID: 3,
        metadata: {},
        gameStates: { 10: { players: { 5: { Civilization: 'Rome', Leader: 'Caesar' } } } },
      };
      expect(diplomat.getParticipantIdentity(params, 5)).toEqual({ name: 'Rome', leader: 'Caesar' });
    });

    it('should fall back to Unknown when no identity is available', () => {
      const params = { playerID: 3, gameStates: {} };
      expect(diplomat.getParticipantIdentity(params, 3)).toBeUndefined();
      expect(diplomat.getSelfIdentity(params)).toEqual({ name: 'Unknown', leader: 'Unknown' });
    });
  });

  describe('Telepathist (TalkativeTelepathist)', () => {
    it('should read the self seat from civilizationName/leaderName', () => {
      const params = { playerID: 2, civilizationName: 'Rome', leaderName: 'Caesar' };
      expect(telepathist.getParticipantIdentity(params, 2)).toEqual({ name: 'Rome', leader: 'Caesar' });
      expect(telepathist.getSelfIdentity(params)).toEqual({ name: 'Rome', leader: 'Caesar' });
    });

    it('should return undefined for any non-self player (observer counterpart)', () => {
      const params = { playerID: 2, civilizationName: 'Rome', leaderName: 'Caesar' };
      expect(telepathist.getParticipantIdentity(params, 9)).toBeUndefined();
    });
  });
});
