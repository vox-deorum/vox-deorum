/** Tests for reusable prepared-state evaluation and triage routing. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  evaluator: vi.fn(),
}));

vi.mock('../../../src/utils/models/resolution.js', () => ({ triageEnabled: mocks.enabled }));
vi.mock('../../../src/utils/models/evaluation.js', () => ({ getEvaluatorConfig: mocks.evaluator }));

import { createTriage, TriageShortcut } from '../../../src/infra/triage.js';

/** Minimal context surface used by createTriage. */
function context() {
  return {
    modelOverrides: { agent: { provider: 'openai', name: 'main', options: { triage: true } } },
    evaluate: vi.fn(async () => ({ answers: { tier: { type: 'choice', choice: 'large' } } })),
  } as any;
}

describe('createTriage', () => {
  beforeEach(() => {
    mocks.enabled.mockReset().mockReturnValue(true);
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
      answers: { urgency: { probability: 1 } },
    });
    expect(ctx.evaluate).toHaveBeenCalledWith(expect.anything(), prepared, { questions });
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
      .resolves.toEqual(shortcut.decision);
    expect(ctx.evaluate).not.toHaveBeenCalled();
  });

  it('should skip state projection and evaluation when either opt-in gate is closed', async () => {
    const projectState = vi.fn(() => 'state');
    const hook = createTriage({ projectState });
    const ctx = context();

    mocks.enabled.mockReturnValue(false);
    await expect(hook.call({ name: 'agent' } as any, {} as any, {}, ctx, { system: '', messages: [] }))
      .resolves.toBeUndefined();
    expect(mocks.evaluator).not.toHaveBeenCalled();

    mocks.enabled.mockReturnValue(true);
    mocks.evaluator.mockReturnValue(undefined);
    await expect(hook.call({ name: 'agent' } as any, {} as any, {}, ctx, { system: '', messages: [] }))
      .resolves.toBeUndefined();
    expect(projectState).not.toHaveBeenCalled();
    expect(ctx.evaluate).not.toHaveBeenCalled();
  });
});
