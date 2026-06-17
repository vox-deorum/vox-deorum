/**
 * Tests for the victory-progress getter: the Lua boundary is stubbed and the
 * tag-stripping + VictoryProgress store-write path runs for real against an in-memory
 * store. Victory progress is global knowledge stored under the fixed Key = 0.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupStore } from '../../helpers.js';
import { LuaFunction } from '../../../../src/bridge/lua-function.js';
import { getVictoryProgress } from '../../../../src/knowledge/getters/victory-progress.js';
import type { KnowledgeStore } from '../../../../src/knowledge/store.js';

let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupStore(10);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

/** Stub the Lua boundary to return a canned victory-progress payload (array form). */
function mockLua(result: unknown, success = true) {
  vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success, result } as any);
}

const sampleVictory = () => ({
  DominationVictory: 'In progress',
  ScienceVictory: 'Behind',
  CulturalVictory: 'Leading',
  DiplomaticVictory: {
    ActiveResolutions: {
      '[COLOR_POSITIVE_TEXT]World Religion[ENDCOLOR]': {
        Description: 'Choose a [ICON_PEACE]religion[ENDCOLOR]',
        Votes: 5,
      },
    },
    Proposals: {
      '[COLOR_POSITIVE_TEXT]Arts Funding[ENDCOLOR]': {
        Description: 'Boost [ICON_CULTURE]culture[ENDCOLOR]',
        Votes: 2,
      },
    },
  },
});

describe('getVictoryProgress', () => {
  it('returns null when the Lua call fails', async () => {
    mockLua(undefined, false);
    expect(await getVictoryProgress()).toBeNull();
  });

  it('returns null when the Lua result is empty', async () => {
    mockLua([]);
    expect(await getVictoryProgress()).toBeNull();
  });

  it('strips localization tags from diplomatic data and persists under Key 0', async () => {
    mockLua([sampleVictory()]);

    const result = await getVictoryProgress();
    expect(result).not.toBeNull();

    // Resolution/proposal names and descriptions are stripped of tags.
    const resolutions = result!.DiplomaticVictory!.ActiveResolutions as Record<string, any>;
    expect(Object.keys(resolutions)).toEqual(['World Religion']);
    expect(resolutions['World Religion'].Description).toBe('Choose a religion');
    expect(resolutions['World Religion'].Votes).toBe(5);

    const proposals = result!.DiplomaticVictory!.Proposals as Record<string, any>;
    expect(Object.keys(proposals)).toEqual(['Arts Funding']);
    expect(proposals['Arts Funding'].Description).toBe('Boost culture');

    // Persisted as global mutable knowledge under Key = 0.
    const stored = await store.getMutableKnowledge('VictoryProgress', 0);
    expect(stored).toBeTruthy();
    expect(stored!.DominationVictory).toBe('In progress');
    expect(stored!.Turn).toBe(10);
    const storedResolutions = (stored!.DiplomaticVictory as any).ActiveResolutions;
    expect(Object.keys(storedResolutions)).toEqual(['World Religion']);
  });

  it('does not write to the store when saving=false', async () => {
    mockLua([sampleVictory()]);
    const result = await getVictoryProgress(false);
    expect(result).not.toBeNull();
    expect(await store.getMutableKnowledge('VictoryProgress', 0)).toBeFalsy();
  });
});
