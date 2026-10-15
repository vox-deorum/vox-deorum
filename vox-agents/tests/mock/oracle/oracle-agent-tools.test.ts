/**
 * Tests for how OracleAgent replays the original run's tool removals: removedToolsAtStep maps a
 * replay step to what the original had removed by then, and prepareStep removes those tools from the
 * replay's declared list while keeping tools a modifyPrompt override added. getOutput exports only
 * calls that would have run.
 */

import { describe, it, expect } from 'vitest';
// Load the agent graph through the registry first, avoiding the circular-import hazard of reaching an
// agent module directly.
import '../../../src/infra/agent-registry.js';
import { OracleAgent, removedToolsAtStep } from '../../../src/oracle/oracle-agent.js';
import type { OracleParameters } from '../../../src/oracle/types.js';
import type { ModelMessage } from 'ai';
import { cacheBreakpoint, hasCacheBreakpoint } from '../../../src/utils/models/cache-breakpoint.js';

/** Build oracle parameters with the given declared tools and recorded per-step lists. */
function params(activeTools: string[], stepTools: string[][]): OracleParameters {
  return {
    playerID: 1,
    gameID: 'g',
    turn: 5,
    activeTools,
    stepTools,
    resolvedModel: { provider: 'test', name: 'test' } as any,
    capturedSteps: [],
  };
}

/** A context with no registered tools and no model overrides, enough for prepareStep. */
const context = { tools: {}, modelOverrides: {} } as any;

/** A last step that called a tool, so the base empty-reply rescue stays out of the way. */
const toolStep = { toolCalls: [{ toolName: 'a' }], text: '', response: { messages: [] } } as any;

describe('removedToolsAtStep', () => {
  it('returns what the original had removed by each step, holding the last list afterwards', () => {
    const recorded = [['a', 'b', 'c'], ['a', 'c'], ['a']];
    expect(removedToolsAtStep(recorded, 0)).toEqual([]);
    expect(removedToolsAtStep(recorded, 1)).toEqual(['b']);
    expect(removedToolsAtStep(recorded, 2)).toEqual(['b', 'c']);
    expect(removedToolsAtStep(recorded, 5)).toEqual(['b', 'c']);
  });

  it('removes nothing without recorded steps', () => {
    expect(removedToolsAtStep([], 3)).toEqual([]);
  });
});

describe('OracleAgent.prepareStep', () => {
  const agent = new OracleAgent();

  it('leaves the first step and unnarrowed runs at the declared list', async () => {
    const first = await agent.prepareStep(params(['a', 'b'], [['a', 'b'], ['a']]), {} as any, null, [], [], context);
    expect(first.activeTools).toBeUndefined();
    const flat = await agent.prepareStep(params(['a', 'b'], [['a', 'b']]), {} as any, toolStep, [toolStep], [], context);
    expect(flat.activeTools).toBeUndefined();
  });

  it('removes the recorded removals from the declared list, keeping added tools', async () => {
    // modifyPrompt added "extra"; the original removed "b" on its second step.
    const config = await agent.prepareStep(params(['a', 'b', 'extra'], [['a', 'b'], ['a']]), {} as any,
      toolStep, [toolStep], [], context);
    expect(config.activeTools).toEqual(['a', 'extra']);
  });
});

describe('OracleAgent.getInitialMessages', () => {
  const agent = new OracleAgent();
  const input = (messages: ModelMessage[]) => ({ system: [], messages, row: {} as any });
  const messages: ModelMessage[] = [
    { role: 'user', content: 'earlier', providerOptions: { ...cacheBreakpoint } },
    { role: 'user', content: 'last' },
  ];

  it('should mark the end of the prompt when it is replayed several times, leaving the input untouched', async () => {
    const result = await agent.getInitialMessages({ ...params([], []), cachePrompt: true }, input(messages), context);
    expect(result.map(hasCacheBreakpoint)).toEqual([true, true]);
    expect(hasCacheBreakpoint(messages[1])).toBe(false);
  });

  it('should keep the original breakpoints only for a single replay', async () => {
    const result = await agent.getInitialMessages(params([], []), input(messages), context);
    expect(result.map(hasCacheBreakpoint)).toEqual([true, false]);
  });
});

describe('OracleAgent.getOutput', () => {
  const agent = new OracleAgent();

  it('exports only the calls that would have run, so a rejected call never supplies the rationale', async () => {
    const parameters = params(['set-strategy', 'keep-status-quo'], []);
    parameters.capturedSteps.push({
      toolCalls: [
        { toolName: 'set-strategy', input: { Rationale: 'rejected' }, invalid: true },
        { toolName: 'keep-status-quo', input: { Rationale: 'kept' } },
      ],
      response: { messages: [] },
    } as any);

    const result = await agent.getOutput(parameters, { row: {}, metadata: {} } as any, '', context);
    expect(result!.decisions).toEqual([{ toolName: 'keep-status-quo', args: {}, rationale: 'kept' }]);
  });
});
