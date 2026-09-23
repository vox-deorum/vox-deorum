/** Tests for diplomat intent routing and prepared-state triage. */

import { describe, expect, it, vi } from 'vitest';
import type { EnvoyThread } from '../../../../src/types/index.js';
import { agentRegistry } from '../../../../src/infra/agent-registry.js';

const diplomat = agentRegistry.get('diplomat')!;

/** Build typed answers for one scripted diplomatic situation. */
function answers(intent: 'deal' | 'threat' | 'request' | 'small talk', stakes: number) {
  return {
    intent: { type: 'choice', choice: intent, probabilities: {} },
    stakes: { type: 'score', score: stakes, probabilities: [] },
  } as any;
}

/** Build a diplomacy thread for the diplomat's mode checks. */
function thread(content: string): EnvoyThread {
  return {
    id: 'dipl:g:1:3', agent: 3, gameID: 'g', player1ID: 1, player2ID: 3,
    contextType: 'live', contextId: 'g-player-3', diplomacy: true,
    messages: [{ message: { role: 'user', content }, metadata: { datetime: new Date(0), turn: 0 } }],
  };
}

describe('Diplomat.triage', () => {
  const prepared = { system: 'prepared prompt', messages: [] };

  /** Build the evaluator context used by the shared prepared-state hook. */
  function triageContext(modelOverrides: Record<string, any>, scripted = answers('request', 1)) {
    return {
      modelOverrides,
      evaluate: vi.fn(async () => ({ answers: scripted })),
    } as any;
  }

  const enabledAssignment = {
    diplomat: { provider: 'openai', name: 'main', options: { triage: true } },
    evaluator: { provider: 'typesafe', name: 'jev-latest' },
  };

  it('should skip evaluation when triage is disabled', async () => {
    const ctx = triageContext({
      diplomat: { provider: 'openai', name: 'main' },
      evaluator: enabledAssignment.evaluator,
    });

    await expect(diplomat.triage?.({}, thread('context'), ctx, prepared)).resolves.toBeUndefined();
    expect(ctx.evaluate).not.toHaveBeenCalled();
  });

  it('should skip evaluation when no evaluator is configured', async () => {
    const ctx = triageContext({
      diplomat: enabledAssignment.diplomat,
    });

    await expect(diplomat.triage?.({}, thread('context'), ctx, prepared)).resolves.toBeUndefined();
    expect(ctx.evaluate).not.toHaveBeenCalled();
  });

  it('should choose the small tier for greeting mode without evaluating', async () => {
    const ctx = triageContext(enabledAssignment);

    await expect(diplomat.triage?.({}, thread('{{{Greeting}}}'), ctx, prepared)).resolves.toEqual({
      tier: 'small',
      source: 'shortcut',
      note: 'special message',
    });
    expect(ctx.evaluate).not.toHaveBeenCalled();
  });

  it.each([
    ['small talk', 3, 'small'],
    ['deal', 2, 'large'],
    ['threat', 3, 'large'],
    ['deal', 3, 'large'],
    ['threat', 1, 'default'],
    ['request', 3, 'default'],
    ['small talk', 0, 'small'],
  ] as const)('should route evaluator answers for %s at stakes %s to %s', async (intent, stakes, tier) => {
    const ctx = triageContext(enabledAssignment, answers(intent, stakes));

    await expect(diplomat.triage?.({}, thread('context'), ctx, prepared)).resolves.toMatchObject({ tier, source: 'evaluator' });
    expect(ctx.evaluate).toHaveBeenCalledWith(expect.anything(), [], { questions: expect.any(Object), purpose: 'triage' });
  });

  it('should evaluate a bounded tail of the prepared messages without the system prompt', async () => {
    const ctx = triageContext(enabledAssignment);
    const messages = Array.from({ length: 20 }, (_, index) => ({
      role: 'user', content: `message ${index}`, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    }));

    await diplomat.triage?.({}, thread('context'), ctx, { system: 'prepared prompt', messages } as any);
    const state = ctx.evaluate.mock.calls[0][1] as Array<{ role: string; content: string }>;
    expect(state.length).toBeGreaterThan(0);
    expect(state.length).toBeLessThan(messages.length);
    expect(state.at(-1)).toEqual({ role: 'user', content: 'message 19' });
    expect(JSON.stringify(state)).not.toContain('prepared prompt');
    expect(JSON.stringify(state)).not.toContain('providerOptions');
  });
});
