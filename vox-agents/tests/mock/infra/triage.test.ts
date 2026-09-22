/** Tests for the reusable evaluator-backed agent triage hook. */

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

  it('should combine a static instruction with the current input and use the default tier question', async () => {
    const hook = createTriage('Assess this task.');
    const ctx = context();
    const decision = await hook.call({ name: 'agent' } as any, { turn: 7 } as any, { task: 'respond' }, ctx);

    expect(decision?.tier).toBe('large');
    expect(ctx.evaluate.mock.calls[0][1]).toEqual({
      instructions: 'Assess this task.',
      input: { task: 'respond' },
    });
  });

  it('should await a state builder and route custom typed answers', async () => {
    const adapter = vi.fn(async () => ({ summary: 'bounded state' }));
    const questions = {
      urgency: { type: 'boolean', instructions: 'Is this urgent?' },
    } as const;
    const ctx = context();
    ctx.evaluate.mockResolvedValue({ answers: { urgency: { type: 'boolean', probability: 1 } } });
    const hook = createTriage(adapter, {
      questions,
      route: answers => ({ tier: answers.urgency.probability >= 0.5 ? 'large' : 'small' }),
    });

    await expect(hook.call({ name: 'agent' } as any, { turn: 7 } as any, {}, ctx)).resolves.toMatchObject({ tier: 'large' });
    expect(adapter).toHaveBeenCalledOnce();
    expect(ctx.evaluate.mock.calls[0][1]).toEqual({ summary: 'bounded state' });
  });

  it('should return a shortcut decision without an evaluator call', async () => {
    const hook = createTriage(async () => new TriageShortcut({ tier: 'small', note: 'routine' }));
    const ctx = context();

    await expect(hook.call({ name: 'agent' } as any, {} as any, {}, ctx)).resolves.toEqual({ tier: 'small', note: 'routine' });
    expect(ctx.evaluate).not.toHaveBeenCalled();
  });

  it('should run both gates before invoking the prompt adapter', async () => {
    const adapter = vi.fn(async () => 'state');
    const hook = createTriage(adapter);
    const ctx = context();

    mocks.enabled.mockReturnValue(false);
    await expect(hook.call({ name: 'agent' } as any, {} as any, {}, ctx)).resolves.toBeUndefined();
    expect(mocks.evaluator).not.toHaveBeenCalled();
    expect(adapter).not.toHaveBeenCalled();

    mocks.enabled.mockReturnValue(true);
    mocks.evaluator.mockReturnValue(undefined);
    await expect(hook.call({ name: 'agent' } as any, {} as any, {}, ctx)).resolves.toBeUndefined();
    expect(adapter).not.toHaveBeenCalled();
  });
});
