/** Tests for seat role defaults and per-seat triage, files, and prompts resolution (src/strategist/seat-config.ts). */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilesSetting, PlayerConfig, PromptsSetting, TriageSetting } from '../../../src/types/config.js';

const mocks = vi.hoisted(() => ({
  config: { triage: undefined as TriageSetting | undefined, files: undefined as FilesSetting | undefined, prompts: undefined as PromptsSetting | undefined },
}));

vi.mock('../../../src/utils/config.js', () => ({ config: mocks.config }));

import { defaultDiplomat, defaultFilesQuota, resolveSeatFiles, resolveSeatPrompts, resolveSeatTriage, seatAgents } from '../../../src/strategist/seat-config.js';

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

describe('resolveSeatFiles', () => {
  const seat = (files: PlayerConfig['files']): PlayerConfig => ({ strategist: 'simple-strategist', files });

  beforeEach(() => {
    mocks.config.files = undefined;
  });

  it('should let the seat value beat the session and the session beat the root', () => {
    mocks.config.files = 'read';
    expect(resolveSeatFiles(seat('write'), 'read')).toEqual({ game: 'write', shared: {}, quota: defaultFilesQuota });
    expect(resolveSeatFiles(seat(undefined), 'write')).toEqual({ game: 'write', shared: {}, quota: defaultFilesQuota });
  });

  it('should use the root setting when the seat and session are unset', () => {
    mocks.config.files = 'read';
    expect(resolveSeatFiles(seat(undefined))).toEqual({ game: 'read', shared: {}, quota: defaultFilesQuota });
  });

  it('should be off when nothing sets files', () => {
    expect(resolveSeatFiles(seat(undefined))).toBeUndefined();
  });

  it('should let a seat false override a session write', () => {
    expect(resolveSeatFiles(seat(false), 'write')).toBeUndefined();
  });

  it('should expand the read and write shorthands to game access with defaults', () => {
    expect(resolveSeatFiles(seat('read'))).toEqual({ game: 'read', shared: {}, quota: 20 });
    expect(resolveSeatFiles(seat('write'))).toEqual({ game: 'write', shared: {}, quota: 20 });
  });

  it('should pass a full object through with its quota kept', () => {
    expect(resolveSeatFiles(seat({ game: 'write', shared: { lessons: 'read' }, quota: 5 })))
      .toEqual({ game: 'write', shared: { lessons: 'read' }, quota: 5 });
  });

  it('should default the quota when an object omits it', () => {
    expect(resolveSeatFiles(seat({ game: 'read' }))?.quota).toBe(20);
  });

  it('should be off when the object mounts nothing', () => {
    expect(resolveSeatFiles(seat({ game: false }))).toBeUndefined();
    expect(resolveSeatFiles(seat({ shared: {} }))).toBeUndefined();
  });

  it('should report no game access for a shared-only config', () => {
    expect(resolveSeatFiles(seat({ shared: { lessons: 'write' } })))
      .toEqual({ game: false, shared: { lessons: 'write' }, quota: 20 });
  });

  it('should reject a game value outside false, read and write with its config path', () => {
    expect(() => resolveSeatFiles(seat({ game: 'rw' } as never), undefined, 3))
      .toThrow('llmPlayers.3.files.game');
  });

  it('should reject a shared name with spaces or capitals with its config path', () => {
    expect(() => resolveSeatFiles(seat({ shared: { 'Bad Name': 'read' } } as never), undefined, 3))
      .toThrow('llmPlayers.3.files.shared.Bad Name');
  });

  it('should reject a shared name starting with a hyphen with its config path', () => {
    expect(() => resolveSeatFiles(seat({ shared: { '-x': 'read' } } as never), undefined, 3))
      .toThrow('llmPlayers.3.files.shared.-x');
  });

  it('should reject a shared access outside read and write with its config path', () => {
    expect(() => resolveSeatFiles(seat({ shared: { lessons: 'rw' } } as never), undefined, 3))
      .toThrow('llmPlayers.3.files.shared.lessons');
  });

  it('should reject shared given as a list with its config path', () => {
    expect(() => resolveSeatFiles(seat({ shared: ['lessons'] } as never), undefined, 3))
      .toThrow('llmPlayers.3.files.shared');
  });

  it('should reject a zero quota with its config path', () => {
    expect(() => resolveSeatFiles(seat({ game: 'read', quota: 0 } as never), undefined, 3))
      .toThrow('llmPlayers.3.files.quota');
  });

  it('should reject a fractional quota with its config path', () => {
    expect(() => resolveSeatFiles(seat({ game: 'read', quota: 1.5 } as never), undefined, 3))
      .toThrow('llmPlayers.3.files.quota');
  });

  it('should reject a string quota with its config path', () => {
    expect(() => resolveSeatFiles(seat({ game: 'read', quota: '5' } as never), undefined, 3))
      .toThrow('llmPlayers.3.files.quota');
  });

  it('should reject an unknown object key with its config path', () => {
    expect(() => resolveSeatFiles(seat({ game: 'read', mode: 'write' } as never), undefined, 3))
      .toThrow('llmPlayers.3.files.mode');
  });

  it('should reject true as a files setting with its config path', () => {
    expect(() => resolveSeatFiles(seat(true as never), undefined, 3))
      .toThrow('llmPlayers.3.files');
  });

  it('should reject null as a files setting with its config path', () => {
    expect(() => resolveSeatFiles(seat(null as never), undefined, 3))
      .toThrow('llmPlayers.3.files');
  });
});

describe('resolveSeatPrompts', () => {
  beforeEach(() => {
    mocks.config.prompts = undefined;
  });

  it('should use the built-ins when no level sets a folder', () => {
    expect(resolveSeatPrompts({ strategist: 'simple-strategist' }, undefined, 1)).toBe(false);
  });

  it('should prefer the seat over the session over the root', () => {
    mocks.config.prompts = 'root-prompts';
    expect(resolveSeatPrompts({ strategist: 'simple-strategist' }, undefined, 1)).toBe('root-prompts');
    expect(resolveSeatPrompts({ strategist: 'simple-strategist' }, 'session-prompts', 1)).toBe('session-prompts');
    expect(resolveSeatPrompts({ strategist: 'simple-strategist', prompts: 'seat-prompts' }, 'session-prompts', 1)).toBe('seat-prompts');
  });

  it('should let a seat turn a session folder off', () => {
    expect(resolveSeatPrompts({ strategist: 'simple-strategist', prompts: false }, 'session-prompts', 1)).toBe(false);
  });

  it('should reject a setting that is not a folder path, naming the seat slot', () => {
    expect(() => resolveSeatPrompts({ strategist: 'simple-strategist', prompts: true as never }, undefined, 3)).toThrow('llmPlayers.3.prompts');
    expect(() => resolveSeatPrompts({ strategist: 'simple-strategist' }, '' as never, 3)).toThrow('session.prompts');
  });
});
