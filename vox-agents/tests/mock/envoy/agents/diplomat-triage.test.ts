/** Tests for the diplomat's bounded triage state and tier routing. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnvoyThread } from '../../../../src/types/index.js';

const dealMocks = vi.hoisted(() => ({ readActiveProposal: vi.fn() }));
vi.mock('../../../../src/utils/diplomacy/deal/deal.js', () => ({
  readActiveProposal: dealMocks.readActiveProposal,
}));

import {
  buildDiplomatTriageState,
  routeDiplomatTriage,
  type DiplomatTriageAnswers,
} from '../../../../src/envoy/agents/diplomat-triage.js';
import { agentRegistry } from '../../../../src/infra/agent-registry.js';

const diplomat = agentRegistry.get('diplomat')!;

/** Build typed answers for one scripted diplomat scenario. */
function answers(intent: 'deal' | 'threat' | 'request' | 'small talk', stakes: number): DiplomatTriageAnswers {
  return {
    intent: { type: 'choice', choice: intent, probabilities: {} },
    stakes: { type: 'score', score: stakes, probabilities: [] },
  } as DiplomatTriageAnswers;
}

/** Build a compact diplomacy thread for prompt tests. */
function thread(contents: string[]): EnvoyThread {
  return {
    id: 'dipl:g:1:3', agent: 3, gameID: 'g', player1ID: 1, player2ID: 3,
    contextType: 'live', contextId: 'g-player-3', diplomacy: true,
    messages: contents.map((content, index) => ({
      message: { role: 'user', content },
      metadata: { datetime: new Date(index), turn: index },
    })),
  };
}

describe('routeDiplomatTriage', () => {
  it.each([
    ['small talk', 3, 'small'],
    ['deal', 2, 'large'],
    ['threat', 3, 'large'],
    ['deal', 1, 'default'],
    ['request', 3, 'default'],
  ] as const)('should route %s at stakes %s to %s', (intent, stakes, tier) => {
    expect(routeDiplomatTriage(answers(intent, stakes)).tier).toBe(tier);
  });
});

describe('buildDiplomatTriageState', () => {
  it('should include the turn, voiced player, authoritative proposal, and only six recent messages', () => {
    const state = buildDiplomatTriageState(
      { turn: 10 } as any,
      thread(Array.from({ length: 8 }, (_, index) => `message-${index}`)),
      { status: 'open', active: { ID: 42, SpeakerID: 1, Message: 'Peace for gold' }, proposals: [] } as any,
    );

    expect(state.turn).toBe(10);
    expect(state.voicedPlayerID).toBe(3);
    expect(state.openProposal?.ID).toBe(42);
    expect(state.messages).toHaveLength(6);
    expect(state.messages[0].content).toBe('message-2');
  });

  it('should leave out a proposal that is no longer open', () => {
    const state = buildDiplomatTriageState(
      { turn: 10 } as any,
      thread(['hello']),
      { status: 'rejected', active: { ID: 42 }, proposals: [] } as any,
    );
    expect(state.openProposal).toBeUndefined();
  });
});

describe('Diplomat.triage', () => {
  /** Build the context surface used by the shared hook with scripted evaluator answers. */
  function triageContext(modelOverrides: Record<string, any>, scripted = answers('request', 1)) {
    return {
      modelOverrides,
      evaluate: vi.fn(async () => ({ answers: scripted })),
      memoizeForExecution: (_key: string, load: () => Promise<unknown>) => load(),
    } as any;
  }

  beforeEach(() => {
    dealMocks.readActiveProposal.mockReset().mockResolvedValue({ status: 'none', messages: [] });
  });

  it('should do no prompt or evaluator work when its own assignment leaves triage off', async () => {
    const ctx = triageContext({
      diplomat: { provider: 'openai', name: 'main' },
      evaluator: { provider: 'typesafe', name: 'jev-latest' },
    });
    await expect(diplomat.triage?.({ turn: 10 } as any, thread(['hello']), ctx)).resolves.toBeUndefined();
    expect(dealMocks.readActiveProposal).not.toHaveBeenCalled();
    expect(ctx.evaluate).not.toHaveBeenCalled();
  });

  it('should do no prompt work when the enabled assignment has no evaluator', async () => {
    const ctx = triageContext({
      diplomat: { provider: 'openai', name: 'main', options: { triage: true } },
    });
    await expect(diplomat.triage?.({ turn: 10 } as any, thread(['hello']), ctx)).resolves.toBeUndefined();
    expect(dealMocks.readActiveProposal).not.toHaveBeenCalled();
  });

  it('should choose the small tier for a greeting without reading deal state or evaluating', async () => {
    const ctx = triageContext({
      diplomat: { provider: 'openai', name: 'main', options: { triage: true } },
      evaluator: { provider: 'typesafe', name: 'jev-latest' },
    });
    await expect(diplomat.triage?.(
      { turn: 10 } as any,
      thread(['{{{Greeting}}}']),
      ctx,
    )).resolves.toEqual({ tier: 'small', note: 'special message' });
    expect(dealMocks.readActiveProposal).not.toHaveBeenCalled();
    expect(ctx.evaluate).not.toHaveBeenCalled();
  });

  it.each([
    ['deal', 3, 'large'],
    ['threat', 1, 'default'],
    ['request', 3, 'default'],
    ['small talk', 0, 'small'],
  ] as const)('should route a scripted %s evaluation at stakes %s to %s', async (intent, stakes, tier) => {
    const ctx = triageContext({
      diplomat: { provider: 'openai', name: 'main', options: { triage: true } },
      evaluator: { provider: 'typesafe', name: 'jev-latest' },
    }, answers(intent, stakes));

    await expect(diplomat.triage?.({ turn: 10 } as any, thread(['A new message']), ctx))
      .resolves.toMatchObject({ tier });
    expect(ctx.evaluate).toHaveBeenCalledOnce();
  });
});
