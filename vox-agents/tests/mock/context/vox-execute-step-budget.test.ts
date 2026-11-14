/**
 * Tests for the step budget with files on (src/agents/runtime/vox-execute.ts, VoxAgent.stepLimit): the files
 * quota raises an agent's step limit unless its own maxSteps is higher, bash is declared next to
 * the agent's own tools, and the closing reminder counts down the steps left. Same mocking idiom
 * as vox-execute.test.ts: the mocked model returns empty steps, so the base stopCheck runs every
 * execution to its step limit.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/agents/models/models.js', async (orig) => {
  const actual = await orig<typeof import('../../../src/agents/models/models.js')>();
  return { ...actual, getModel: vi.fn(() => ({} as any)), buildProviderOptions: vi.fn(() => ({})) };
});
vi.mock('../../../src/agents/models/concurrency.js', async (orig) => {
  const actual = await orig<typeof import('../../../src/agents/models/concurrency.js')>();
  return { ...actual, streamTextWithConcurrency: vi.fn() };
});

import { VoxContext } from '../../../src/agents/runtime/vox-context.js';
import { VoxAgent } from '../../../src/agents/runtime/vox-agent.js';
import { agentRegistry } from '../../../src/agents/runtime/agent-registry.js';
import { streamTextWithConcurrency } from '../../../src/agents/models/concurrency.js';
import { bashToolName } from '../../../src/agents/tools/bash-tool.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import { makeStrategistParameters } from '../../helpers/fake-vox-context.js';
import type { Model } from '../../../src/types/index.js';

const stc = vi.mocked(streamTextWithConcurrency);

/** An agent with a fixed maxSteps and tool list, using the base stopCheck. */
class BudgetAgent extends VoxAgent<StrategistParameters> {
  readonly description = 'step budget test agent';
  constructor(public readonly name: string, public override maxSteps: number, private readonly tools?: string[]) { super(); }
  /** Selects a mocked model so no provider is contacted. */
  override getModel(): Model { return { provider: 'test', name: 'test' } as Model; }
  /** Supplies the minimal system prompt required by the execution loop. */
  async getSystem(): Promise<string> { return 'system'; }
  /** Declares the configured tool list. */
  override getActiveTools(): string[] | undefined { return this.tools; }
}

/** A mocked step result with no text and no tool calls. */
function emptyStep() {
  return {
    steps: [{
      text: '',
      content: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      response: { messages: [{ role: 'assistant', content: '' }] },
      toolCalls: [],
      toolResults: [],
    }],
  } as any;
}

/** Record each step's request and answer with an empty step. */
function recordSteps(): any[] {
  const configs: any[] = [];
  stc.mockImplementation(async (config: any) => {
    configs.push(config);
    return emptyStep();
  });
  return configs;
}

/** A seat context with the given files quota, or no files when the quota is undefined. */
function seat(id: string, quota?: number): VoxContext<StrategistParameters> {
  const ctx = new VoxContext<StrategistParameters>({}, id);
  if (quota !== undefined) ctx.files = { game: 'write', shared: {}, quota };
  ctx.registerAgentTools();
  return ctx;
}

/** Run one agent execution in a fresh root run. */
function run(ctx: VoxContext<StrategistParameters>, agent: string) {
  return ctx.withRun({ parameters: makeStrategistParameters() }, () => ctx.execute(agent, {}));
}

/** Agents with a small and a large maxSteps, both using all registered tools. */
const small = new BudgetAgent('budget-small', 3);
const large = new BudgetAgent('budget-large', 6);

beforeAll(() => {
  agentRegistry.register(small as any);
  agentRegistry.register(large as any);
  agentRegistry.register(new BudgetAgent('budget-tools', 1, ['get-briefing']) as any);
  agentRegistry.register(new BudgetAgent('budget-no-tools', 1, []) as any);
});

beforeEach(() => {
  stc.mockReset();
});

/** The closing reminder sent on each recorded step. */
function reminders(configs: any[]): string[] {
  return configs.map((config) => String(config.messages.at(-1).content));
}

describe('step budget with files on', () => {
  it('should raise the step limit to the files quota', async () => {
    const quota = small.maxSteps + 2;
    const configs = recordSteps();
    await run(seat('budget-quota', quota), small.name);
    expect(configs).toHaveLength(quota);
  });

  it('should keep maxSteps without files', async () => {
    const configs = recordSteps();
    await run(seat('budget-plain'), small.name);
    expect(configs).toHaveLength(small.maxSteps);
  });

  it('should keep a maxSteps higher than the quota', async () => {
    const configs = recordSteps();
    await run(seat('budget-high', large.maxSteps - 1), large.name);
    expect(configs).toHaveLength(large.maxSteps);
  });

  it('should count down the steps left to the final decision', async () => {
    const quota = small.maxSteps + 1;
    const configs = recordSteps();
    await run(seat('budget-countdown', quota), small.name);
    const sent = reminders(configs);
    expect(new Set(sent).size).toBe(quota);
    sent.slice(0, -1).forEach((reminder, index) => expect(reminder).toContain(String(quota - index)));
  });

  it('should not count down without files', async () => {
    const configs = recordSteps();
    await run(seat('budget-no-countdown'), small.name);
    // Every later step ends with the same message, so nothing changes from step to step.
    expect(new Set(reminders(configs).slice(1)).size).toBe(1);
  });

  it('should declare bash next to the agent tools only with files on', async () => {
    const configs = recordSteps();
    await run(seat('budget-declare', 1), 'budget-tools');
    await run(seat('budget-declare-off'), 'budget-tools');
    expect(configs[0].activeTools).toEqual(['get-briefing', bashToolName]);
    expect(configs[1].activeTools).toEqual(['get-briefing']);
  });

  it('should leave an empty tool list empty', async () => {
    const configs = recordSteps();
    await run(seat('budget-empty', 1), 'budget-no-tools');
    expect(configs[0].activeTools).toEqual([]);
  });
});

describe('Briefer stop check with files on', () => {
  /** A step with the given text and tool calls. */
  const step = (text: string, ...toolNames: string[]) => ({
    content: [{ type: 'text', text }],
    toolCalls: toolNames.map((toolName) => ({ toolName })),
  }) as any;

  it('should not take text next to a bash call as the briefing', () => {
    const briefer = agentRegistry.get('simple-briefer') as any;
    const ctx = seat('budget-briefer', 5);
    const working = step('Checking my notes first.', bashToolName);
    expect(briefer.stopCheck({}, undefined, working, [working], ctx)).toBe(false);
    const briefing = step('The empire is stable and growing.');
    expect(briefer.stopCheck({}, undefined, briefing, [working, briefing], ctx)).toBe(true);
  });
});
