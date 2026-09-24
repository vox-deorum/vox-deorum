/** Tests for reusable prepared-state evaluation and triage routing. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TriageSetting } from '../../../src/types/config.js';

const mocks = vi.hoisted(() => ({
  evaluator: vi.fn(),
}));

vi.mock('../../../src/utils/models/evaluation.js', () => ({ getEvaluatorConfig: mocks.evaluator }));

import { createTriage, TriageShortcut, triageEnabled } from '../../../src/infra/triage.js';

/** Minimal context surface used by createTriage; the default triages the `agent` name. */
function context(triage: TriageSetting = ['agent']) {
  return {
    triage,
    modelOverrides: { agent: { provider: 'openai', name: 'main' } },
    evaluate: vi.fn(async () => ({ answers: { tier: { type: 'choice', choice: 'large' } } })),
  } as any;
}

describe('createTriage', () => {
  beforeEach(() => {
    mocks.evaluator.mockReset().mockReturnValue({ provider: 'typesafe', name: 'jev-latest' });
  });

  it('should evaluate the prepared state and route typed answers', async () => {
    const prepared = { system: 'system', messages: [{ role: 'user', content: 'context' }] };
    const questions = { urgency: { type: 'boolean', instructions: 'question', criteria: undefined } } as const;
    const route = vi.fn((answers: any) => ({ tier: answers.urgency.probability >= 0.5 ? 'large' as const : 'small' as const }));
    const ctx = context();
    ctx.evaluate.mockResolvedValue({ answers: { urgency: { type: 'boolean', probability: 1 } } });
    const hook = createTriage({ questions, route });

    await expect(hook.call({ name: 'agent' } as any, {} as any, {}, ctx, prepared)).resolves.toMatchObject({
      tier: 'large',
      source: 'evaluator',
      answers: { urgency: { probability: 1 } },
    });
    expect(ctx.evaluate).toHaveBeenCalledWith(expect.anything(), prepared, { questions, purpose: 'triage' });
    expect(route).toHaveBeenCalledOnce();
  });

  it('should project the prepared state only when the caller supplies a projector', async () => {
    const prepared = { system: 'system', messages: [] };
    const projectState = vi.fn(() => ({ facts: ['selected'] }));
    const ctx = context();
    const hook = createTriage({ projectState });

    await hook.call({ name: 'agent' } as any, {} as any, {}, ctx, prepared);

    expect(projectState).toHaveBeenCalledWith(prepared, {}, {}, ctx);
    expect(ctx.evaluate.mock.calls[0][1]).toEqual({ facts: ['selected'] });
  });

  it('should return a deterministic shortcut without evaluating questions', async () => {
    const shortcut = new TriageShortcut({ tier: 'small', note: 'routine' });
    const ctx = context();
    const hook = createTriage({ shortcut: () => shortcut });

    await expect(hook.call({ name: 'agent' } as any, {} as any, {}, ctx, { system: '', messages: [] }))
      .resolves.toEqual({ ...shortcut.decision, source: 'shortcut' });
    expect(ctx.evaluate).not.toHaveBeenCalled();
  });

  it('should skip state projection and evaluation when either opt-in gate is closed', async () => {
    const projectState = vi.fn(() => 'state');
    const hook = createTriage({ projectState });

    // The context's triage setting closes the gate before the evaluator is consulted.
    await expect(hook.call({ name: 'agent' } as any, {} as any, {}, context(false), { system: '', messages: [] }))
      .resolves.toBeUndefined();
    expect(mocks.evaluator).not.toHaveBeenCalled();

    // An agent without an evaluator assignment closes the second gate.
    mocks.evaluator.mockReturnValue(undefined);
    const ctx = context();
    await expect(hook.call({ name: 'agent' } as any, {} as any, {}, ctx, { system: '', messages: [] }))
      .resolves.toBeUndefined();
    expect(projectState).not.toHaveBeenCalled();
    expect(ctx.evaluate).not.toHaveBeenCalled();
  });
});

describe('triageEnabled', () => {
  it('should cover any name when the setting is true', () => {
    expect(triageEnabled('agent', true)).toBe(true);
    expect(triageEnabled('some-other-agent', true)).toBe(true);
  });

  it('should cover only the listed names when the setting is a list', () => {
    expect(triageEnabled('agent', ['agent', 'other'])).toBe(true);
    expect(triageEnabled('unlisted', ['agent', 'other'])).toBe(false);
    expect(triageEnabled('agent', [])).toBe(false);
  });

  it('should cover nothing when the setting is false or unset', () => {
    expect(triageEnabled('agent', false)).toBe(false);
    expect(triageEnabled('agent', undefined)).toBe(false);
  });
});
