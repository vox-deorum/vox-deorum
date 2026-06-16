/**
 * Tests for librarian context extraction (src/librarian/librarian-utils.ts).
 * Pure functions over StrategistParameters — no context, MCP, or model.
 */

import { describe, it, expect } from 'vitest';
import { extractBriefingContexts } from '../../../src/librarian/librarian-utils.js';
import { makeStrategistParameters, makeGameState } from '../../helpers/fake-vox-context.js';

describe('extractBriefingContexts — simple mode', () => {
  it('prefers the working-memory instruction over a prior briefing report', () => {
    const params = makeStrategistParameters({
      workingMemory: { 'briefer-instruction': 'focus on walls' },
      gameStates: { 5: makeGameState(5, { reports: { briefing: 'old briefing' } }) },
    });
    expect(extractBriefingContexts(params, 'simple')).toEqual(['focus on walls']);
  });

  it('falls back to the most recent briefing report when no instruction is set', () => {
    const params = makeStrategistParameters({
      workingMemory: {},
      gameStates: { 5: makeGameState(5, { reports: { briefing: 'recent briefing' } }) },
    });
    expect(extractBriefingContexts(params, 'simple')).toEqual(['recent briefing']);
  });

  it('returns a single empty context when neither instruction nor report exists', () => {
    const params = makeStrategistParameters({ workingMemory: {}, gameStates: {} });
    expect(extractBriefingContexts(params, 'simple')).toEqual(['']);
  });
});

describe('extractBriefingContexts — specialized mode', () => {
  it('returns military/economy/diplomacy contexts in order from working memory', () => {
    const params = makeStrategistParameters({
      workingMemory: {
        'briefer-instruction-military': 'M',
        'briefer-instruction-economy': 'E',
        'briefer-instruction-diplomacy': 'D',
      },
    });
    expect(extractBriefingContexts(params, 'specialized')).toEqual(['M', 'E', 'D']);
  });

  it('falls back to the matching report per slot when an instruction is missing', () => {
    const params = makeStrategistParameters({
      workingMemory: { 'briefer-instruction-economy': 'E-instruction' },
      gameStates: {
        5: makeGameState(5, {
          reports: {
            'briefing-military': 'M-report',
            'briefing-diplomacy': 'D-report',
          },
        }),
      },
    });
    expect(extractBriefingContexts(params, 'specialized')).toEqual(['M-report', 'E-instruction', 'D-report']);
  });

  it('fills missing slots with empty strings when recent state has no reports', () => {
    const params = makeStrategistParameters({ workingMemory: {}, gameStates: {} });
    expect(extractBriefingContexts(params, 'specialized')).toEqual(['', '', '']);
  });
});
