/** Tests for per-execution model triage and frame isolation. */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/models/models.js', async (orig) => {
  const actual = await orig<typeof import('../../../src/utils/models/models.js')>();
  return { ...actual, getModel: vi.fn(() => ({} as any)), buildProviderOptions: vi.fn(() => ({})) };
});
vi.mock('../../../src/utils/models/concurrency.js', async (orig) => {
  const actual = await orig<typeof import('../../../src/utils/models/concurrency.js')>();
  return { ...actual, streamTextWithConcurrency: vi.fn() };
});

import { VoxContext } from '../../../src/infra/vox-context.js';
import { VoxAgent, type AgentParameters, type TriageDecision } from '../../../src/infra/vox-agent.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { streamTextWithConcurrency } from '../../../src/utils/models/concurrency.js';
import { recordSpans } from '../../helpers/recording-tracer.js';
import type { Model } from '../../../src/types/index.js';
import type { ModelSize } from '../../../src/utils/models/models.js';

const stream = vi.mocked(streamTextWithConcurrency);
const parameters: AgentParameters = { playerID: 1, gameID: 'triage-game', turn: 3 };

/** Return one completed model step for execution-loop tests. */
function completedStep() {
  const step = {
    text: 'done',
    usage: { inputTokens: 0, outputTokens: 0 },
    response: { messages: [{ role: 'assistant', content: 'done' }] },
    toolCalls: [],
    toolResults: [],
  };
  return { steps: [step], text: 'done' } as any;
}

/** Minimal agent that records tier selection and the frame visible to its system hook. */
class TriageAgent extends VoxAgent<AgentParameters> {
  readonly description = 'triage execution test agent';
  public readonly tiers: Array<ModelSize | undefined> = [];
  public readonly seen: Array<TriageDecision | undefined> = [];
  public readonly stepDecisions: Array<TriageDecision | undefined> = [];
  public preparedStates: unknown[] = [];
  public initialMessageCalls = 0;
  public triageImpl?: (input: unknown, prepared: unknown) => Promise<TriageDecision | undefined>;
  public systemImpl?: (context: VoxContext<AgentParameters>, input: unknown) => Promise<void>;
  public stepImpl?: (context: VoxContext<AgentParameters>, input: unknown) => Promise<void>;

  constructor(public readonly name: string, private readonly emptySystem = false) { super(); }

  /** Run the test-controlled triage implementation. */
  override async triage(_parameters: AgentParameters, input: unknown, _context: VoxContext<AgentParameters>, prepared: unknown): Promise<TriageDecision | undefined> {
    this.preparedStates.push(prepared);
    return this.triageImpl?.(input, prepared);
  }

  /** Record each tier used for both initial and prepared-step model selection. */
  override getModel(
    _parameters: AgentParameters,
    _input: unknown,
    _overrides: Record<string, Model | string>,
    tier?: ModelSize
  ): Model {
    this.tiers.push(tier);
    return { provider: 'test', name: tier ?? 'unchanged' } as Model;
  }

  /** Record the decision visible through the current child frame. */
  async getSystem(
    _parameters: AgentParameters,
    _input: unknown,
    context: VoxContext<AgentParameters>
  ): Promise<string> {
    this.seen.push(context.currentTriage);
    await this.systemImpl?.(context, _input);
    return this.emptySystem ? '' : 'system';
  }

  /** Count initial prompt assembly so execute tests can verify single preparation. */
  override async getInitialMessages(): Promise<any[]> {
    this.initialMessageCalls++;
    return [{ role: 'user', content: 'initial' }];
  }

  /** Record frame state at the point the selected tier is applied to a model step. */
  override async prepareStep(parameters: AgentParameters, input: unknown, lastStep: any, allSteps: any[], messages: any[], context: VoxContext<AgentParameters>) {
    this.stepDecisions.push(context.currentTriage);
    await this.stepImpl?.(context, input);
    return super.prepareStep(parameters, input, lastStep, allSteps, messages, context);
  }

  /** Keep model-loop tests to one step. */
  override stopCheck(): boolean { return true; }
}

const triaged = new TriageAgent('test-triaged', false);
const noHook = new TriageAgent('test-no-triage', false);
noHook.triage = undefined;
const stepped = new TriageAgent('test-triage-step', false);
const emptySystem = new TriageAgent('test-triage-empty-system', true);
const evaluationAgent = new TriageAgent('test-evaluation-agent', false);

beforeAll(() => {
  agentRegistry.register(triaged);
  agentRegistry.register(noHook);
  agentRegistry.register(stepped);
  agentRegistry.register(emptySystem);
  agentRegistry.register(evaluationAgent);
});

beforeEach(() => {
  for (const agent of [triaged, noHook, stepped, emptySystem, evaluationAgent]) {
    agent.tiers.length = 0;
    agent.seen.length = 0;
    agent.stepDecisions.length = 0;
    agent.preparedStates.length = 0;
    agent.initialMessageCalls = 0;
    agent.triageImpl = undefined;
    agent.systemImpl = undefined;
    agent.stepImpl = undefined;
  }
  stream.mockReset();
  stream.mockResolvedValue(completedStep());
});

describe('VoxContext.execute triage', () => {
  it('should run the hook once before model selection and expose its decision', async () => {
    const hook = vi.fn(async () => ({ tier: 'small', note: 'routine' } as const));
    triaged.triageImpl = hook;
    const context = new VoxContext<AgentParameters>({}, 'triage-hook');
    const spans = recordSpans(context);

    await context.withRun({ parameters }, () => context.execute(triaged.name, {}));

    expect(hook).toHaveBeenCalledOnce();
    expect(triaged.tiers).toEqual(['small', 'small']);
    expect(triaged.seen).toEqual([undefined]);
    expect(triaged.stepDecisions).toEqual([{ tier: 'small', note: 'routine' }]);
    expect(triaged.initialMessageCalls).toBe(1);
    expect(triaged.preparedStates).toHaveLength(1);
    expect(triaged.preparedStates[0]).toMatchObject({ system: 'system', messages: [{ role: 'user' }] });
    expect(spans.find(span => span.name === `agent.${triaged.name}`)?.attributes).toMatchObject({
      'triage.tier': 'small',
      'triage.baseline': 'default',
      'triage.note': 'routine',
    });
  });

  it('should leave agents without a hook unchanged', async () => {
    const context = new VoxContext<AgentParameters>({}, 'triage-none');
    const spans = recordSpans(context);
    await context.withRun({ parameters }, () => context.execute(noHook.name, {}));
    expect(noHook.tiers).toEqual([undefined, undefined]);
    expect(noHook.seen).toEqual([undefined]);
    expect(spans.find(span => span.name === `agent.${noHook.name}`)?.attributes).toMatchObject({ 'triage.baseline': 'default' });
  });

  it('should keep the agent tier and note the failure when triage throws', async () => {
    triaged.triageImpl = async () => { throw new Error('evaluator offline'); };
    const context = new VoxContext<AgentParameters>({}, 'triage-fallback');
    const spans = recordSpans(context);
    await context.withRun({ parameters }, () => context.execute(triaged.name, {}));
    expect(triaged.tiers).toEqual(['default', 'default']);
    expect(triaged.seen).toEqual([undefined]);
    expect(triaged.stepDecisions).toEqual([{ tier: 'default', source: 'failed', note: 'triage failed' }]);
    expect(spans.find(span => span.name === `agent.${triaged.name}`)?.attributes).toMatchObject({
      'triage.tier': 'default',
      'triage.source': 'failed',
      'triage.baseline': 'default',
      'triage.note': 'triage failed',
    });
  });

  it('should not move a small agent up a tier when triage throws', async () => {
    const small = new TriageAgent('test-triage-small');
    small.modelSize = 'small';
    small.triageImpl = async () => { throw new Error('evaluator offline'); };
    agentRegistry.register(small);
    const context = new VoxContext<AgentParameters>({}, 'triage-small-fallback');
    await context.withRun({ parameters }, () => context.execute(small.name, {}));
    expect(small.tiers).toEqual(['small', 'small']);
  });

  it('should use a supplied decision without invoking the hook', async () => {
    const hook = vi.fn(async () => ({ tier: 'small' } as const));
    triaged.triageImpl = hook;
    const context = new VoxContext<AgentParameters>({}, 'triage-supplied');
    const spans = recordSpans(context);
    const supplied = { tier: 'large', answers: { stakes: 1 } } as const;
    await context.withRun({ parameters }, () => context.execute(
      triaged.name, {}, undefined, undefined, undefined, { triage: supplied }
    ));
    expect(hook).not.toHaveBeenCalled();
    expect(triaged.tiers).toEqual(['large', 'large']);
    expect(triaged.seen).toEqual([undefined]);
    expect(triaged.stepDecisions).toEqual([{ ...supplied, source: 'caller' }]);
    expect(spans.find(span => span.name === `agent.${triaged.name}`)?.attributes).toMatchObject({
      'triage.tier': 'large',
      'triage.source': 'caller',
      'triage.baseline': 'default',
    });
  });

  it('should keep the selected tier when prepareStep selects the actual step model', async () => {
    stepped.triageImpl = async () => ({ tier: 'large' });
    const context = new VoxContext<AgentParameters>({}, 'triage-prepared-step');
    await context.withRun({ parameters }, () => context.execute(stepped.name, {}));
    expect(stepped.tiers).toEqual(['large', 'large']);
  });

  it('should restore the parent decision after a nested execution', async () => {
    triaged.triageImpl = async () => ({ tier: 'large', note: 'parent' });
    noHook.systemImpl = async context => {
      expect(context.currentTriage).toBeUndefined();
    };
    triaged.stepImpl = async context => {
      await context.execute(noHook.name, {}, undefined, undefined, undefined, { throwOnError: true });
      expect(context.currentTriage).toEqual({ tier: 'large', note: 'parent' });
    };
    const context = new VoxContext<AgentParameters>({}, 'triage-nested');
    await context.withRun({ parameters }, () => context.execute(
      triaged.name, {}, undefined, undefined, undefined, { throwOnError: true }
    ));
    expect(context.currentTriage).toBeUndefined();
  });

  it('should isolate decisions across concurrent root runs', async () => {
    const observed = new Map<string, TriageDecision | undefined>();
    let releaseFirst!: () => void;
    const firstPaused = new Promise<void>(resolve => { releaseFirst = resolve; });
    let firstReady!: () => void;
    const ready = new Promise<void>(resolve => { firstReady = resolve; });
    triaged.triageImpl = async (input) => ({ tier: (input as { tier: ModelSize }).tier });
    triaged.stepImpl = async (context, input) => {
      const key = (input as { key: string }).key;
      if (key === 'first') {
        firstReady();
        await firstPaused;
      } else {
        await ready;
      }
      observed.set(key, context.currentTriage);
      if (key === 'second') releaseFirst();
    };
    const context = new VoxContext<AgentParameters>({}, 'triage-concurrent');
    await Promise.all([
      context.withRun({ parameters }, () => context.execute(triaged.name, { key: 'first', tier: 'small' })),
      context.withRun({ parameters }, () => context.execute(triaged.name, { key: 'second', tier: 'large' })),
    ]);
    expect(observed.get('first')).toEqual({ tier: 'small' });
    expect(observed.get('second')).toEqual({ tier: 'large' });
  });

  it('should not start model work after triage cancels its root', async () => {
    const context = new VoxContext<AgentParameters>({}, 'triage-cancel');
    triaged.triageImpl = async () => {
      context.abort();
      throw new Error('cancelled');
    };
    await context.withRun({ parameters }, () => context.execute(triaged.name, {}));
    expect(triaged.tiers).toEqual([]);
    expect(triaged.seen).toEqual([undefined]);
  });

  it('should preserve empty-system agents without constructing messages or selecting a model', async () => {
    const context = new VoxContext<AgentParameters>({}, 'triage-empty-system');
    emptySystem.triageImpl = vi.fn(async () => ({ tier: 'large' }));

    await context.withRun({ parameters }, () => context.execute(emptySystem.name, {}));

    expect(emptySystem.initialMessageCalls).toBe(0);
    expect(emptySystem.tiers).toEqual([]);
    expect(emptySystem.preparedStates).toEqual([]);
  });

  it('should execute an evaluation agent with the prepared prompt and skip the chat loop', async () => {
    const tokenOutput = { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 };
    const evaluation = vi.fn(async (_parameters, _input, _context, prepared, _model, sink) => {
      expect(prepared).toMatchObject({ system: 'system', messages: [{ role: 'user' }] });
      expect(sink).toBe(tokenOutput);
      return { result: 'evaluated' };
    });
    const postprocess = vi.fn((_parameters, _input, output) => ({ ...output, processed: true }));
    evaluationAgent.executeEvaluation = evaluation;
    evaluationAgent.postprocessOutput = postprocess;
    const context = new VoxContext<AgentParameters>({}, 'evaluation-agent');

    await expect(context.withRun({ parameters }, () => context.execute(
      evaluationAgent.name, {}, undefined, tokenOutput,
    ))).resolves.toEqual({ result: 'evaluated', processed: true });

    expect(evaluationAgent.initialMessageCalls).toBe(1);
    expect(evaluation).toHaveBeenCalledOnce();
    expect(postprocess).toHaveBeenCalledOnce();
    expect(stream).not.toHaveBeenCalled();
  });
});

describe('VoxContext.memoizeForExecution', () => {
  it('should share one load within an execution and isolate nested executions', async () => {
    const load = vi.fn(async () => ({}));
    const values: unknown[] = [];
    noHook.systemImpl = async context => {
      values.push(await context.memoizeForExecution('state', load));
    };
    triaged.systemImpl = async context => {
      const first = await context.memoizeForExecution('state', load);
      expect(await context.memoizeForExecution('state', load)).toBe(first);
      await context.execute(noHook.name, {}, undefined, undefined, undefined, { throwOnError: true });
      values.push(first);
    };
    const context = new VoxContext<AgentParameters>({}, 'memo-frames');
    await context.withRun({ parameters }, () => context.execute(
      triaged.name, {}, undefined, undefined, undefined, { throwOnError: true }
    ));
    expect(load).toHaveBeenCalledTimes(2);
    expect(values[0]).not.toBe(values[1]);
  });

  it('should retry a load after it rejects', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('ready');
    triaged.systemImpl = async context => {
      await expect(context.memoizeForExecution('state', load)).rejects.toThrow('offline');
      await expect(context.memoizeForExecution('state', load)).resolves.toBe('ready');
    };
    const context = new VoxContext<AgentParameters>({}, 'memo-retry');
    await context.withRun({ parameters }, () => context.execute(
      triaged.name, {}, undefined, undefined, undefined, { throwOnError: true }
    ));
    expect(load).toHaveBeenCalledTimes(2);
  });
});
