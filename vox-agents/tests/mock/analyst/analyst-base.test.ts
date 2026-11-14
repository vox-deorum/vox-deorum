/**
 * Tests for the base Analyst class behavior, exercised through the concrete
 * DiplomaticAnalyst instance resolved from the registry (the canonical load entry,
 * which also sidesteps circular-import hazards).
 *
 * Covers the shared report handoff schema. Span/context detachment is
 * intentionally NOT tested here.
 */

import { describe, it, expect } from 'vitest';
import { agentRegistry } from '../../../src/agents/runtime/agent-registry.js';

const analyst = agentRegistry.get('diplomatic-analyst') as any;

describe('Analyst handoff schema', () => {
  it('accepts a report without optional civilization names', () => {
    const parsed = analyst.handoffSchema.parse({
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
    expect(() => analyst.handoffSchema.parse({ Content: 'only content' })).toThrow();
  });
});
