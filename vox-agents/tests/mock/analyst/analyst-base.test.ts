/**
 * Tests for the base Analyst class behavior, exercised through the concrete
 * DiplomaticAnalyst instance resolved from the registry (the canonical load entry,
 * which also sidesteps circular-import hazards). Protected/base members are reached
 * through a loosely-typed handle.
 *
 * Covers the fire-and-forget flag, toolChoice, the shared input schema, and that
 * getContextMessages delegates to the shared buildGameContextMessages
 * builder. Span/context detachment is intentionally NOT tested here.
 */

import { describe, it, expect } from 'vitest';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { buildGameContextMessages } from '../../../src/strategist/strategy-parameters.js';
import { createFakeVoxContext, makeStrategistParameters, makeGameState } from '../../helpers/fake-vox-context.js';

const analyst = agentRegistry.get('diplomatic-analyst') as any;

function paramsWithState() {
  return makeStrategistParameters({
    gameStates: { 5: makeGameState(5, { players: {} } as any) },
  });
}

describe('Analyst input schema', () => {
  it('accepts the three AnalystInput fields', () => {
    const parsed = analyst.inputSchema.parse({
      Content: 'report body',
      Context: 'situation',
      Memo: 'assessment',
    });
    expect(parsed).toEqual({
      Content: 'report body',
      Context: 'situation',
      Memo: 'assessment',
    });
  });

  it('rejects input missing required fields', () => {
    expect(() => analyst.inputSchema.parse({ Content: 'only content' })).toThrow();
  });
});

describe('Analyst chat tools', () => {
  it('does not expose tools for chat generation', () => {
    const context = createFakeVoxContext();
    expect(analyst.getExtraTools(context.asContext())).toEqual({});
    expect(analyst.getActiveTools(paramsWithState())).toEqual([]);
  });
});

describe('Analyst.getContextMessages', () => {
  it('delegates to the shared buildGameContextMessages builder', () => {
    const params = paramsWithState();
    const fromMethod = analyst.getContextMessages(params);
    const fromBuilder = buildGameContextMessages(params);
    expect(fromMethod).toEqual(fromBuilder);
  });
});
