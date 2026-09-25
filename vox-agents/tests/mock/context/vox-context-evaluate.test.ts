/**
 * Tests for the single-call evaluation path (src/infra/vox-evaluate.ts, exercised through
 * VoxContext.evaluate()). The evaluation-model factory is mocked so `experimental_evaluate` runs
 * for real against a stub model with a scripted result (usage plus TypeSafe-style confidence
 * metadata). Covers the active-run requirement, answer/usage flow-back, token accrual to the run
 * handle, the seat-wide totals, and the per-call token output, the `evaluate` span contract, and
 * error recording with a re-throw. Same tracer idiom as vox-execute.test.ts.
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

// Mock only the evaluation-model factory; keep the real SDK call, coercion, and telemetry.
vi.mock('../../../src/utils/models/evaluation.js', async (orig) => {
  const actual = await orig<typeof import('../../../src/utils/models/evaluation.js')>();
  return { ...actual, getEvaluationModel: vi.fn() };
});

import { SpanStatusCode } from '@opentelemetry/api';
import type {
  Experimental_EvaluationModelV4 as EvaluationModelV4,
  Experimental_EvaluationModelV4Result as EvaluationModelV4Result,
  Experimental_EvaluationModelV4Question as EvaluationModelV4Question,
} from '@ai-sdk/provider';
import { VoxContext } from '../../../src/infra/vox-context.js';
import { VoxAgent, type AgentParameters } from '../../../src/infra/vox-agent.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { getEvaluationModel } from '../../../src/utils/models/evaluation.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import { makeStrategistParameters } from '../../helpers/fake-vox-context.js';
import { recordSpans } from '../../helpers/recording-tracer.js';
import type { Model } from '../../../src/types/index.js';

const factory = vi.mocked(getEvaluationModel);

/** One boolean question keeps the SDK's strict answer validation satisfied. */
const questions = {
  urgent: {
    type: 'boolean',
    instructions: 'Does it need a decision now?',
  },
} satisfies Record<string, EvaluationModelV4Question>;

const testModel = { provider: 'typesafe', name: 'jev-latest' } as Model;
const selectedAgentModel = { provider: 'typesafe', name: 'selected-native-evaluator' } as Model;

/** Exercise evaluation through the ordinary agent execution boundary. */
class EvaluationExecutionAgent extends VoxAgent<StrategistParameters, unknown, unknown> {
  readonly name = 'test-evaluation-execution';
  readonly description = 'Evaluation execution test agent';
  readonly preparedSystems: string[] = [];
  readonly preparedMessages: unknown[][] = [];
  readonly selectedModels: Model[] = [];
  systemBuilds = 0;
  initialMessageBuilds = 0;
  outputBuilds = 0;
  postprocessCalls = 0;

  /** Select a known evaluator model so the native evaluator factory call can be checked. */
  override getModel(): Model {
    return selectedAgentModel;
  }

  /** Return the system part of the prepared evaluation state. */
  override async getSystem(): Promise<string> {
    this.systemBuilds++;
    return 'prepared-system';
  }

  /** Return the initial-message part of the prepared evaluation state. */
  override async getInitialMessages() {
    this.initialMessageBuilds++;
    return [{ role: 'user' as const, content: 'prepared-context' }];
  }

  /** Evaluate prepared state directly and pass the execution token sink through. */
  override async executeEvaluation(
    _parameters: StrategistParameters,
    _input: unknown,
    context: VoxContext<StrategistParameters>,
    prepared: { system: string; messages: any[] },
    model: Model,
    tokenOutput?: { inputTokens: number; reasoningTokens: number; outputTokens: number },
  ) {
    this.preparedSystems.push(prepared.system);
    this.preparedMessages.push(prepared.messages);
    this.selectedModels.push(model);
    const result = await context.evaluate(model, prepared, { questions, tokenOutput });
    return result.answers;
  }

  /** Count chat output conversion calls, which evaluation execution must bypass. */
  override async getOutput(): Promise<undefined> {
    this.outputBuilds++;
    return undefined;
  }

  /** Count the shared final processing step. */
  override postprocessOutput(_parameters: StrategistParameters, _input: unknown, output: unknown) {
    this.postprocessCalls++;
    return output;
  }
}

const evaluationAgent = new EvaluationExecutionAgent();

beforeAll(() => {
  agentRegistry.register(evaluationAgent);
});

/** Scripted provider metadata: confidence keyed by question id, as the typesafe provider reports it. */
const confidence = { urgent: 0.9 };

/** A stub evaluation model returning the fixed answers, usage, and confidence for these questions. */
function successfulModel(): EvaluationModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'typesafe',
    modelId: 'jev-latest',
    supportedQuestionTypes: ['choice', 'score', 'boolean'],
    doEvaluate: async (): Promise<EvaluationModelV4Result> => ({
      answers: { urgent: { type: 'boolean', probability: 0.7 } },
      usage: { inputTokens: 30, outputTokens: 4 },
      warnings: [],
      response: { modelId: 'jev-latest', timestamp: new Date() },
      providerMetadata: { typesafe: { confidence } },
    }),
  };
}

/** A stub evaluation model whose provider call always fails. */
function failingModel(): EvaluationModelV4 {
  return {
    specificationVersion: 'v4',
    provider: 'typesafe',
    modelId: 'jev-latest',
    supportedQuestionTypes: ['choice', 'score', 'boolean'],
    doEvaluate: async (): Promise<EvaluationModelV4Result> => {
      throw new Error('evaluate boom');
    },
  };
}

beforeEach(() => {
  factory.mockReset();
  factory.mockReturnValue(successfulModel());
});

describe('VoxContext.evaluate active-run requirement', () => {
  it('should reject outside a run without opening a span or contacting the model', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'eval-no-run');
    const spans = recordSpans(ctx);

    await expect(ctx.evaluate(testModel, {}, { questions })).rejects.toThrow(
      'VoxContext.evaluate requires an active run; call withRun() or forkRun().',
    );

    expect(spans).toHaveLength(0);
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('VoxContext.evaluate success path', () => {
  it('should flow answers and usage back and accrue tokens to every sink', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'eval-ok');
    recordSpans(ctx);
    const tokenOutput = { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 };
    let runTokens: { inputTokens: number; reasoningTokens: number; outputTokens: number } | undefined;

    const result = await ctx.withRun(
      { parameters: makeStrategistParameters(), overrides: { turn: 7 } },
      async (run) => {
        const evaluation = await ctx.evaluate(testModel, { a: 1 }, { questions, tokenOutput });
        runTokens = run.tokens;
        return evaluation;
      },
    );

    expect(result.answers.urgent).toEqual({ type: 'boolean', probability: 0.7 });
    expect(result.usage).toMatchObject({ inputTokens: 30, outputTokens: 4 });
    expect(result.providerMetadata).toEqual({ typesafe: { confidence } });

    // The factory receives the caller's model and the context as its concurrency host.
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0]![0]).toBe(testModel);
    expect(factory.mock.calls[0]![1]).toBe(ctx);

    // Token accrual: run handle sink, seat-wide totals, and the per-call output all match.
    expect(runTokens).toEqual({ inputTokens: 30, reasoningTokens: 0, outputTokens: 4 });
    expect(tokenOutput).toEqual({ inputTokens: 30, reasoningTokens: 0, outputTokens: 4 });
    expect(ctx.inputTokens).toBe(30);
    expect(ctx.reasoningTokens).toBe(0);
    expect(ctx.outputTokens).toBe(4);
  });

  it('should record the full evaluate span contract under the run', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'eval-span');
    const spans = recordSpans(ctx);

    await ctx.withRun({ parameters: makeStrategistParameters(), overrides: { turn: 7 } }, async () => {
      await ctx.evaluate(testModel, { a: 1 }, { questions });
    });

    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.name).toBe('evaluate');
    expect(span.attributes).toEqual({
      'vox.context.id': 'eval-span',
      'game.turn': '7',
      'model': 'typesafe/jev-latest',
      'evaluate.purpose': 'execution',
      'evaluate.state': '{"a":1}',
      'evaluate.questions': JSON.stringify(questions),
      'evaluate.answers': JSON.stringify({ urgent: { type: 'boolean', probability: 0.7 } }),
      'evaluate.confidence': JSON.stringify(confidence),
      'tokens.input': 30,
      'tokens.reasoning': 0,
      'tokens.output': 4,
    });
    expect(span.status).toEqual({ code: SpanStatusCode.OK });
    expect(span.ended).toBe(true);
  });

  it('should execute an evaluation agent once and accrue its native evaluator usage once', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'eval-agent');
    const spans = recordSpans(ctx);
    const tokenOutput = { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 };
    let runTokens: { inputTokens: number; reasoningTokens: number; outputTokens: number } | undefined;

    const result = await ctx.withRun(
      { parameters: makeStrategistParameters(), overrides: { turn: 7 } },
      async (run) => {
        const output = await ctx.execute(
          evaluationAgent.name,
          {},
          undefined,
          tokenOutput,
          undefined,
          { triage: { tier: 'large' } },
        );
        runTokens = run.tokens;
        return output;
      },
    );

    expect(result).toEqual({ urgent: { type: 'boolean', probability: 0.7 } });
    expect(evaluationAgent.systemBuilds).toBe(1);
    expect(evaluationAgent.initialMessageBuilds).toBe(1);
    expect(evaluationAgent.preparedSystems).toEqual(['prepared-system']);
    expect(evaluationAgent.preparedMessages).toEqual([[{ role: 'user', content: 'prepared-context' }]]);
    expect(evaluationAgent.selectedModels).toEqual([selectedAgentModel]);
    expect(evaluationAgent.outputBuilds).toBe(0);
    expect(evaluationAgent.postprocessCalls).toBe(1);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0]![0]).toBe(selectedAgentModel);
    expect(factory.mock.calls[0]![1]).toBe(ctx);
    expect(runTokens).toEqual({ inputTokens: 30, reasoningTokens: 0, outputTokens: 4 });
    expect(tokenOutput).toEqual({ inputTokens: 30, reasoningTokens: 0, outputTokens: 4 });
    expect(ctx.inputTokens).toBe(30);
    expect(ctx.reasoningTokens).toBe(0);
    expect(ctx.outputTokens).toBe(4);
    expect(spans.find(span => span.name === `agent.${evaluationAgent.name}.evaluate`)?.attributes).toMatchObject({
      'agent.name': evaluationAgent.name,
      'evaluate.purpose': 'execution',
    });
  });
});

describe('VoxContext.evaluate failure path', () => {
  it('should record the span error, accrue nothing, and rethrow', async () => {
    factory.mockReturnValue(failingModel());
    const ctx = new VoxContext<StrategistParameters>({}, 'eval-error');
    const spans = recordSpans(ctx);

    await ctx.withRun({ parameters: makeStrategistParameters(), overrides: { turn: 7 } }, async (run) => {
      await expect(ctx.evaluate(testModel, 'the situation', { questions })).rejects.toThrow('evaluate boom');
      expect(run.tokens).toEqual({ inputTokens: 0, reasoningTokens: 0, outputTokens: 0 });
    });

    const span = spans.find(s => s.name === 'evaluate')!;
    expect(span.exception).toBeInstanceOf(Error);
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: 'evaluate boom' });
    expect(span.ended).toBe(true);
    expect(ctx.inputTokens).toBe(0);
    expect(ctx.outputTokens).toBe(0);
  });
});
