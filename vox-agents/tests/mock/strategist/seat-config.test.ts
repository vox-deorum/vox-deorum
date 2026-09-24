/** Tests for seat role defaults and per-seat triage resolution (src/strategist/seat-config.ts). */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerConfig, TriageSetting } from '../../../src/types/config.js';

const mocks = vi.hoisted(() => ({
  config: { triage: undefined as TriageSetting | undefined },
}));

vi.mock('../../../src/utils/config.js', () => ({ config: mocks.config }));

import { defaultDiplomat, resolveSeatTriage, seatAgents } from '../../../src/strategist/seat-config.js';

describe('seatAgents', () => {
  it('should default the diplomat to the built-in agent when the seat names none', () => {
    expect(seatAgents({ strategist: 'simple-strategist' }, 0).diplomat).toBe(defaultDiplomat);
  });

  it('should pass the seat-named agents through', () => {
    expect(seatAgents({ strategist: 'staff-strategist', diplomat: 'envoy-diplomat', negotiator: 'deal-maker' }, 2))
      .toEqual({ strategist: 'staff-strategist', diplomat: 'envoy-diplomat', negotiator: 'deal-maker' });
  });

  it('should reject a diplomat set to options instead of an agent name', () => {
    // The old shape: an object carrying options.triage where a name belongs.
    const playerConfig: PlayerConfig = { strategist: 'simple-strategist', diplomat: { options: { triage: true } } as never };
    expect(() => seatAgents(playerConfig, 1)).toThrow('llmPlayers.1.diplomat');
  });

  it('should reject a strategist set to something other than an agent name', () => {
    const playerConfig: PlayerConfig = { strategist: { triage: true } as never };
    expect(() => seatAgents(playerConfig, 0)).toThrow('llmPlayers.0.strategist');
  });
});

describe('resolveSeatTriage', () => {
  beforeEach(() => {
    mocks.config.triage = undefined;
  });

  it('should let the seat value beat the session and the session beat the root', () => {
    mocks.config.triage = false;
    expect(resolveSeatTriage({ strategist: 'simple-strategist', triage: true }, false)).toBe(true);
    expect(resolveSeatTriage({ strategist: 'simple-strategist' }, true)).toBe(true);
  });

  it('should use the root setting when the seat and session are unset', () => {
    mocks.config.triage = true;
    expect(resolveSeatTriage({ strategist: 'simple-strategist' })).toBe(true);
  });

  it('should be off when nothing sets triage', () => {
    expect(resolveSeatTriage({ strategist: 'simple-strategist' })).toBe(false);
  });

  it('should let a seat false or empty list override a session true', () => {
    expect(resolveSeatTriage({ strategist: 'simple-strategist', triage: false }, true)).toBe(false);
    expect(resolveSeatTriage({ strategist: 'simple-strategist', triage: [] }, true)).toEqual([]);
  });

  it('should also cover the seat strategist when the list names the role', () => {
    expect(resolveSeatTriage({ strategist: 'staff-strategist', triage: ['strategist'] }))
      .toEqual(['strategist', 'staff-strategist']);
  });

  it('should cover the seat diplomat name for a custom diplomat', () => {
    expect(resolveSeatTriage({ strategist: 'simple-strategist', diplomat: 'envoy-diplomat', triage: ['diplomat'] }))
      .toEqual(['diplomat', 'envoy-diplomat']);
  });

  it('should cover the default diplomat when the seat names none', () => {
    expect(resolveSeatTriage({ strategist: 'simple-strategist', triage: ['diplomat'] }))
      .toEqual([defaultDiplomat]);
  });

  it('should pass a plain agent name through unchanged', () => {
    expect(resolveSeatTriage({ strategist: 'simple-strategist', triage: ['diplomatic-analyst'] }))
      .toEqual(['diplomatic-analyst']);
  });

  it('should reject a malformed seat setting with its config slot', () => {
    expect(() => resolveSeatTriage({ strategist: 'simple-strategist', triage: 'diplomat' as never }, undefined, 2))
      .toThrow('llmPlayers.2.triage must be a boolean or a list of non-empty agent names');
  });

  it('should reject a malformed session setting', () => {
    expect(() => resolveSeatTriage({ strategist: 'simple-strategist' }, ['diplomat', 1] as never))
      .toThrow('session.triage must be a boolean or a list of non-empty agent names');
  });

  it('should reject a malformed root setting', () => {
    mocks.config.triage = null as never;
    expect(() => resolveSeatTriage({ strategist: 'simple-strategist' }))
      .toThrow('config.triage must be a boolean or a list of non-empty agent names');
  });

  it('should reject empty agent names in a list', () => {
    expect(() => resolveSeatTriage({ strategist: 'simple-strategist', triage: ['  '] }))
      .toThrow('seat triage must be a boolean or a list of non-empty agent names');
  });
});
