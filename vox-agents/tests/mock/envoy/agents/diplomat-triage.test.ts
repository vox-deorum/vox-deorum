/** Tests for diplomat intent routing and its compact triage state. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnvoyThread, TriageSetting } from '../../../../src/types/index.js';
import { agentRegistry } from '../../../../src/infra/agent-registry.js';

const diplomat = agentRegistry.get('diplomat')!;

/** Build typed answers for one scripted diplomatic situation. */
function answers(intent: 'deal' | 'threat' | 'request' | 'small talk', stakes: number) {
  return {
    intent: { type: 'choice', choice: intent, probabilities: {} },
    stakes: { type: 'score', score: stakes, probabilities: [] },
  } as any;
}

/** Build a diplomacy thread for the diplomat's mode checks, one counterpart row per content. */
function thread(...contents: string[]): EnvoyThread {
  return {
    id: 'dipl:g:1:3', agent: 3, gameID: 'g', player1ID: 1, player2ID: 3,
    contextType: 'live', contextId: 'g-player-3', diplomacy: true,
    messages: contents.map(content => ({ message: { role: 'user', content }, metadata: { datetime: new Date(0), turn: 0 } })),
  };
}

describe('Diplomat.triage', () => {
  const prepared = { system: 'prepared prompt', messages: [{ role: 'system', content: 'turn hint' }] };

  /** Stub the memoized turn context so triage reads a scripted deal without MCP calls. */
  function stubTurnContext(openProposalID?: number) {
    vi.spyOn(diplomat as any, 'readTurnContext').mockResolvedValue({
      deal: { text: 'deal context with possible items', openProposalID },
      dealRenderer: () => undefined,
    });
  }

  beforeEach(() => stubTurnContext());
  afterEach(() => vi.restoreAllMocks());

  /** Build the evaluator context used by the shared prepared-state hook; the default triages the diplomat. */
  function triageContext(
    modelOverrides: Record<string, any>,
    scripted = answers('request', 1),
    triage: TriageSetting = ['diplomat'],
  ) {
    return {
      triage,
      modelOverrides,
      evaluate: vi.fn(async () => ({ answers: scripted })),
    } as any;
  }

  const enabledAssignment = {
    diplomat: { provider: 'openai', name: 'main' },
    evaluator: { provider: 'typesafe', name: 'jev-latest' },
  };

  it('should skip evaluation when triage is disabled', async () => {
    const ctx = triageContext(enabledAssignment, undefined, false);

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
    expect(ctx.evaluate).toHaveBeenCalledWith(expect.anything(), expect.any(Object), { questions: expect.any(Object), purpose: 'triage' });
  });

  it('should evaluate only the recent conversation when no deal is open', async () => {
    const ctx = triageContext(enabledAssignment);
    const rows = Array.from({ length: 20 }, (_, index) => `message ${index}`);

    await diplomat.triage?.({}, thread(...rows), ctx, prepared);
    const state = ctx.evaluate.mock.calls[0][1] as { conversation: string; dealContext?: string };
    expect(state.conversation).toContain('message 19');
    expect(state.conversation).toContain('message 12');
    expect(state.conversation).not.toContain('message 11');
    expect(state).not.toHaveProperty('dealContext');
    expect(JSON.stringify(state)).not.toContain('prepared prompt');
    expect(JSON.stringify(state)).not.toContain('turn hint');
  });

  it('should include the whole deal context while a deal is open', async () => {
    stubTurnContext(7);
    const ctx = triageContext(enabledAssignment);

    await diplomat.triage?.({}, thread('let us trade'), ctx, prepared);
    const state = ctx.evaluate.mock.calls[0][1] as { conversation: string; dealContext?: string };
    expect(state.conversation).toContain('let us trade');
    expect(state.dealContext).toBe('deal context with possible items');
  });
});
