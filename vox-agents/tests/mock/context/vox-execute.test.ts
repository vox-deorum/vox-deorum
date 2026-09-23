/**
 * Telemetry contract tests for the agent execution loop (src/infra/vox-execute.ts, exercised
 * through VoxContext.execute()).
 *
 * The agent and step spans must carry exactly the standard context/turn/agent attributes and
 * close with an OK status (or ERROR status plus a recorded exception when the model step throws),
 * and token accrual must land on the active root's sink, the seat-wide totals, and the optional
 * ExecuteTokenOutput. Same mocking idiom as vox-context-execute-runs.test.ts (mocked model
 * factory + streamTextWithConcurrency); the context tracer is swapped for the shared recording
 * fake, while the real @opentelemetry/api context plumbing stays in play.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Mock only the model factory + streaming call; keep the rest of each module real.
vi.mock('../../../src/utils/models/models.js', async (orig) => {
  const actual = await orig<typeof import('../../../src/utils/models/models.js')>();
  return { ...actual, getModel: vi.fn(() => ({} as any)), buildProviderOptions: vi.fn(() => ({})) };
});
vi.mock('../../../src/utils/models/concurrency.js', async (orig) => {
  const actual = await orig<typeof import('../../../src/utils/models/concurrency.js')>();
  return { ...actual, streamTextWithConcurrency: vi.fn() };
});

import { SpanStatusCode } from '@opentelemetry/api';
import { VoxContext } from '../../../src/infra/vox-context.js';
import { VoxAgent } from '../../../src/infra/vox-agent.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { streamTextWithConcurrency } from '../../../src/utils/models/concurrency.js';
import { buildProviderOptions } from '../../../src/utils/models/models.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import { makeStrategistParameters } from '../../helpers/fake-vox-context.js';
import { recordSpans } from '../../helpers/recording-tracer.js';
import type { Model } from '../../../src/types/index.js';

const stc = vi.mocked(streamTextWithConcurrency);
const bpo = vi.mocked(buildProviderOptions);

/** A fake one-step model result with fixed usage, in the shape the step loop consumes. */
function fakeResult(text = 'done') {
  const step = {
    text,
    usage: {
      inputTokens: 100,
      inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokens: 20,
      outputTokenDetails: { textTokens: 10, reasoningTokens: 10 },
      totalTokens: 120,
    },
    response: { messages: [{ role: 'assistant', content: text }] },
    toolCalls: [],
    toolResults: [],
  };
  return { steps: [step], text } as any;
}

/** Minimal real one-step agent (mirrors the runs suite), recording its hook receiver. */
class TelemetryStepAgent extends VoxAgent<StrategistParameters> {
  readonly description = 'telemetry-contract one-step test agent';
  /** The context object the loop passed into getSystem, for identity assertions. */
  public hookContext?: unknown;
  constructor(public readonly name: string) { super(); }
  /** Selects a mocked non-Codex model so no provider is contacted. */
  override getModel(): Model { return { provider: 'test', name: 'test' } as Model; }
  /** Supplies the minimal system prompt required by the execution loop. */
  async getSystem(_p: StrategistParameters, _i: unknown, ctx: VoxContext<StrategistParameters>): Promise<string> {
    this.hookContext = ctx;
    return 'system';
  }
  /** Runs without tools so the mocked step needs no tool results. */
  override getActiveTools(): string[] { return []; }
  /** Stops after one mocked step. */
  override stopCheck(): boolean { return true; }
}

const telAgent = new TelemetryStepAgent('tel-step-agent');

beforeAll(() => {
  agentRegistry.register(telAgent as any);
});

beforeEach(() => {
  stc.mockReset();
  stc.mockImplementation(async () => fakeResult());
  bpo.mockReset();
  bpo.mockImplementation(() => ({}));
});

describe('VoxContext.execute agent span telemetry', () => {
  it('records the baseline even when an empty system prompt ends execution', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'tel-empty-system');
    const spans = recordSpans(ctx);
    const system = vi.spyOn(telAgent, 'getSystem').mockResolvedValueOnce('');
    try {
      await ctx.withRun({ parameters: makeStrategistParameters() }, () => ctx.execute('tel-step-agent', {}));
      expect(spans.find(s => s.name === 'agent.tel-step-agent')?.attributes).toMatchObject({
        'triage.baseline': 'default',
      });
      expect(stc).not.toHaveBeenCalled();
    } finally {
      system.mockRestore();
    }
  });

  it('opens the agent span with the exact standard attributes and closes it OK with final usage', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'tel-agent-span');
    const spans = recordSpans(ctx);
    const base = makeStrategistParameters();
    const tokenOutput = { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 };

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async run => {
      const result = await ctx.execute('tel-step-agent', { hello: 'world' }, undefined, tokenOutput);
      expect(result).toBe('done');

      const agentSpan = spans.find(s => s.name === 'agent.tel-step-agent')!;
      expect(agentSpan).toBeDefined();
      // The full attribute contract: nothing more, nothing less.
      expect(agentSpan.attributes).toEqual({
        'vox.context.id': 'tel-agent-span',
        'game.turn': '1',
        'agent.name': 'tel-step-agent',
        'agent.input': '{"hello":"world"}',
        'triage.baseline': 'default',
        'model': 'test/test',
        'tokens.input': 100,
        'tokens.reasoning': 10,
        'tokens.output': 5,
        'tokens.input.cached': 0,
      });
      expect(agentSpan.status).toEqual({ code: SpanStatusCode.OK });
      expect(agentSpan.ended).toBe(true);

      // Token accrual: the active root's sink absorbed this execution's counts.
      expect(run.tokens).toEqual({ inputTokens: 100, reasoningTokens: 10, outputTokens: 5 });

      // The loop passes the context through with its VoxContext identity intact,
      // into both the agent hooks and streamTextWithConcurrency.
      expect(stc.mock.calls[0]![1]).toBe(ctx);
      expect(telAgent.hookContext).toBe(ctx);
    });

    // Seat-wide totals and the optional per-execution output carry the same counts.
    expect(tokenOutput).toEqual({ inputTokens: 100, reasoningTokens: 10, outputTokens: 5 });
    expect(ctx.inputTokens).toBe(100);
    expect(ctx.reasoningTokens).toBe(10);
    expect(ctx.outputTokens).toBe(5);
  });
});

describe('VoxContext.execute step span telemetry', () => {
  it('opens a step span with the standard step attributes and the mocked step usage', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'tel-step-span');
    const spans = recordSpans(ctx);
    const base = makeStrategistParameters();

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async () => {
      await ctx.execute('tel-step-agent', {});
    });

    const stepSpan = spans.find(s => s.name === 'agent.tel-step-agent.step.1')!;
    expect(stepSpan).toBeDefined();
    // Standard opening attributes.
    expect(stepSpan.attributes['vox.context.id']).toBe('tel-step-span');
    expect(stepSpan.attributes['game.turn']).toBe('1');
    expect(stepSpan.attributes['agent.name']).toBe('tel-step-agent');
    expect(stepSpan.attributes['step.number']).toBe(1);
    // Step configuration attributes.
    expect(stepSpan.attributes['step.tools']).toBe('[]');
    expect(stepSpan.attributes['step.tools.choice']).toBe('auto');
    // Step result attributes: usage matches the agent span and the same sinks.
    expect(stepSpan.attributes['model']).toBe('test/test');
    expect(stepSpan.attributes['tokens.input']).toBe(100);
    expect(stepSpan.attributes['tokens.reasoning']).toBe(10);
    expect(stepSpan.attributes['tokens.output']).toBe(5);
    expect(stepSpan.attributes['tokens.input.cached']).toBe(0);
    expect(stepSpan.attributes['step.responses']).toBe('[{"role":"assistant","content":"done"}]');
    expect(stepSpan.attributes['step.should_stop']).toBe(true);
    expect(stepSpan.status).toEqual({ code: SpanStatusCode.OK });
    expect(stepSpan.ended).toBe(true);

    expect(ctx.inputTokens).toBe(100);
    expect(ctx.reasoningTokens).toBe(10);
    expect(ctx.outputTokens).toBe(5);
  });
});

describe('VoxContext.execute error telemetry', () => {
  it('records the failure on both spans, ends them, and rethrows when throwOnError is set', async () => {
    stc.mockRejectedValue(new Error('model boom'));
    const ctx = new VoxContext<StrategistParameters>({}, 'tel-error-span');
    const spans = recordSpans(ctx);
    const base = makeStrategistParameters();

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async () => {
      await expect(
        ctx.execute('tel-step-agent', {}, undefined, undefined, undefined, { throwOnError: true })
      ).rejects.toThrow('model boom');
    });

    const stepSpan = spans.find(s => s.name === 'agent.tel-step-agent.step.1')!;
    expect(stepSpan.exception).toBeInstanceOf(Error);
    expect(stepSpan.status).toEqual({ code: SpanStatusCode.ERROR, message: 'model boom' });
    expect(stepSpan.ended).toBe(true);

    const agentSpan = spans.find(s => s.name === 'agent.tel-step-agent')!;
    expect(agentSpan.exception).toBeInstanceOf(Error);
    expect(agentSpan.status).toEqual({ code: SpanStatusCode.ERROR, message: 'model boom' });
    expect(agentSpan.ended).toBe(true);

    // A failed execution accrues nothing to any sink.
    expect(ctx.inputTokens).toBe(0);
    expect(ctx.reasoningTokens).toBe(0);
    expect(ctx.outputTokens).toBe(0);
  });

  it('swallows the failure and resolves undefined when throwOnError is not set', async () => {
    stc.mockRejectedValue(new Error('model boom'));
    const ctx = new VoxContext<StrategistParameters>({}, 'tel-error-swallow');
    const spans = recordSpans(ctx);
    const base = makeStrategistParameters();

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async run => {
      await expect(ctx.execute('tel-step-agent', {})).resolves.toBeUndefined();
      expect(run.tokens).toEqual({ inputTokens: 0, reasoningTokens: 0, outputTokens: 0 });
    });

    const agentSpan = spans.find(s => s.name === 'agent.tel-step-agent')!;
    expect(agentSpan.exception).toBeInstanceOf(Error);
    expect(agentSpan.status).toEqual({ code: SpanStatusCode.ERROR, message: 'model boom' });
    expect(agentSpan.ended).toBe(true);
  });
});
