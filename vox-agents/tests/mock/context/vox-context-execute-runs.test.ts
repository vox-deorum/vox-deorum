/**
 * execute()-driven run-model tests for VoxContext (src/infra/vox-context.ts).
 *
 * These drive the real execute() step loop with the model layer (streamTextWithConcurrency) and
 * model factory (getModel/buildProviderOptions) mocked, so no network or provider is touched.
 * Covers: per-execution token accrual routed to the active root sink + seat totals + the optional
 * ExecuteTokenOutput; nested executions sharing the parent root's sink; aborting one root
 * mid-step while a concurrent root's step completes unaffected; and shutdown's teardown race.
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

import { VoxContext } from '../../../src/infra/vox-context.js';
import { VoxAgent } from '../../../src/infra/vox-agent.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { streamTextWithConcurrency } from '../../../src/utils/models/concurrency.js';
import { buildProviderOptions } from '../../../src/utils/models/models.js';
import { spanProcessor } from '../../../src/instrumentation.js';
import { VoxSpanExporter } from '../../../src/utils/telemetry/vox-exporter.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import { makeStrategistParameters } from '../../helpers/fake-vox-context.js';
import type { Model } from '../../../src/types/index.js';
import { buildCompletionToolsNudge } from '../../../src/utils/tools/tool-names.js';
import { buildRescuePrompt } from '../../../src/utils/models/text-cleaning.js';

const stc = vi.mocked(streamTextWithConcurrency);
const bpo = vi.mocked(buildProviderOptions);

/** A fake one-step model result with fixed usage, in the shape executeAgentStep consumes. */
function fakeResult(text = 'done') {
  const step = {
    text,
    usage: { inputTokens: 100, reasoningTokens: 10, outputTokens: 20 },
    response: { messages: [{ role: 'assistant', content: text }] },
    toolCalls: [],
    toolResults: [],
  };
  return { steps: [step], text } as any;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return { promise, resolve };
}

/** Minimal real agent that runs exactly one model step (mocked) and returns its text. */
class StepAgent extends VoxAgent<StrategistParameters> {
  readonly description = 'one-step test agent';
  constructor(public readonly name: string) { super(); }
  override getModel(): Model { return { provider: 'test', name: 'test' } as Model; }
  async getSystem(): Promise<string> { return 'system'; }
  override getActiveTools(): string[] { return []; }
  override stopCheck(): boolean { return true; } // stop after one step
}

/** Minimal Codex agent verifying vox-context leaves the required tool choice untouched. */
class CodexStepAgent extends VoxAgent<StrategistParameters> {
  readonly description = 'one-step Codex compatibility test agent';
  constructor(public readonly name: string) { super(); }
  /** Selects a Codex model without contacting the real provider. */
  override getModel(): Model { return { provider: 'codex', name: 'test' } as Model; }
  /** Supplies the minimal system prompt required by the execution loop. */
  async getSystem(): Promise<string> { return 'system'; }
  /** Keeps a tool active so the agent's default required choice is evaluated. */
  override getActiveTools(): string[] { return ['test-tool']; }
  /** Stops after the mocked model step. */
  override stopCheck(): boolean { return true; }
}

/** Two-step Codex agent verifying the loop threads the proxy's response id into the next step. */
class CodexThreadAgent extends VoxAgent<StrategistParameters> {
  readonly description = 'two-step Codex continuation test agent';
  constructor(public readonly name: string) { super(); }
  /** Selects a Codex model without contacting the real provider. */
  override getModel(): Model { return { provider: 'codex', name: 'test' } as Model; }
  /** Supplies the minimal system prompt required by the execution loop. */
  async getSystem(): Promise<string> { return 'system'; }
  /** Runs without tools so the mocked steps need no tool results. */
  override getActiveTools(): string[] { return []; }
  /** Stops once both mocked steps have run. */
  override stopCheck(_parameters: StrategistParameters, _input: unknown, _lastStep: any, allSteps: any[]): boolean {
    return allSteps.length >= 2;
  }
}

/** Two-step generic agent verifying non-Codex providers never receive a continuation selector. */
class TwoStepAgent extends VoxAgent<StrategistParameters> {
  readonly description = 'two-step test agent';
  constructor(public readonly name: string) { super(); }
  /** Selects a mocked non-Codex model. */
  override getModel(): Model { return { provider: 'test', name: 'test' } as Model; }
  /** Supplies the minimal system prompt required by the execution loop. */
  async getSystem(): Promise<string> { return 'system'; }
  /** Runs without tools so the mocked steps need no tool results. */
  override getActiveTools(): string[] { return []; }
  /** Stops once both mocked steps have run. */
  override stopCheck(_parameters: StrategistParameters, _input: unknown, _lastStep: any, allSteps: any[]): boolean {
    return allSteps.length >= 2;
  }
}

/** Two-step agent whose second prepareStep call narrows the available completion tools. */
class DynamicNudgeAgent extends VoxAgent<StrategistParameters> {
  readonly name = 'test-dynamic-nudge';
  readonly description = 'dynamic continuation-nudge test agent';
  override completionTools = ['finish-a', 'finish-b'];

  /** Selects a mocked model. */
  override getModel(): Model { return { provider: 'test', name: 'test' } as Model; }

  /** Supplies the minimal system prompt required by the execution loop. */
  async getSystem(): Promise<string> { return 'system'; }

  /** Starts with both completion tools available. */
  override getActiveTools(): string[] { return ['finish-a', 'finish-b']; }

  /** Narrows the second step after the base preparation has completed. */
  override async prepareStep(
    parameters: StrategistParameters,
    input: unknown,
    lastStep: any,
    allSteps: any[],
    messages: any[],
    context: VoxContext<StrategistParameters>,
  ) {
    const config = await super.prepareStep(parameters, input, lastStep, allSteps, messages, context);
    if (allSteps.length > 0) config.activeTools = ['finish-b'];
    return config;
  }

  /** Stops after the continuation step. */
  override stopCheck(
    _parameters: StrategistParameters,
    _input: unknown,
    _lastStep: any,
    allSteps: any[],
  ): boolean {
    return allSteps.length >= 2;
  }
}

/** Three-step agent whose completion tool stays active, so every continuation derives the same nudge. */
class RepeatNudgeAgent extends VoxAgent<StrategistParameters> {
  readonly name = 'test-repeat-nudge';
  readonly description = 'continuation-nudge dedup test agent';
  override completionTools = ['finish-a'];

  /** Selects a mocked model. */
  override getModel(): Model { return { provider: 'test', name: 'test' } as Model; }

  /** Supplies the minimal system prompt required by the execution loop. */
  async getSystem(): Promise<string> { return 'system'; }

  /** Keeps the completion tool available on every step. */
  override getActiveTools(): string[] { return ['finish-a']; }

  /** Runs three steps, so the nudge is derived twice against the same trailing message. */
  override stopCheck(
    _parameters: StrategistParameters,
    _input: unknown,
    _lastStep: any,
    allSteps: any[],
  ): boolean {
    return allSteps.length >= 3;
  }
}

/** Agent that performs a nested execute() inside its initial-message hook, then runs its own step. */
class NestingAgent extends VoxAgent<StrategistParameters> {
  readonly description = 'nesting test agent';
  constructor(public readonly name: string, private readonly child: string) { super(); }
  override getModel(): Model { return { provider: 'test', name: 'test' } as Model; }
  async getSystem(): Promise<string> { return 'system'; }
  override getActiveTools(): string[] { return []; }
  override stopCheck(): boolean { return true; }
  override async getInitialMessages(_p: StrategistParameters, _i: unknown, ctx: VoxContext<StrategistParameters>) {
    await ctx.execute(this.child, { kind: 'child-input' });
    return [];
  }
}

/** Minimal diplomacy-only agent (one mocked step), used to exercise the execute() boundary guard. */
class DiplomacyOnlyAgent extends VoxAgent<StrategistParameters> {
  readonly description = 'diplomacy-only test agent';
  override diplomacyOnly = true;
  constructor(public readonly name: string) { super(); }
  override getModel(): Model { return { provider: 'test', name: 'test' } as Model; }
  async getSystem(): Promise<string> { return 'system'; }
  override getActiveTools(): string[] { return []; }
  override stopCheck(): boolean { return true; }
}

beforeAll(() => {
  agentRegistry.register(new StepAgent('test-step-a') as any);
  agentRegistry.register(new StepAgent('test-step-b') as any);
  agentRegistry.register(new StepAgent('test-step-child') as any);
  agentRegistry.register(new CodexStepAgent('test-step-codex') as any);
  agentRegistry.register(new CodexThreadAgent('test-codex-thread') as any);
  agentRegistry.register(new TwoStepAgent('test-two-step') as any);
  agentRegistry.register(new DynamicNudgeAgent() as any);
  agentRegistry.register(new RepeatNudgeAgent() as any);
  agentRegistry.register(new NestingAgent('test-nesting', 'test-step-child') as any);
  agentRegistry.register(new DiplomacyOnlyAgent('test-diplomacy-only') as any);
});

beforeEach(() => {
  stc.mockReset();
  stc.mockImplementation(async () => fakeResult());
  bpo.mockReset();
  bpo.mockImplementation(() => ({}));
});

describe('VoxContext.execute token accounting', () => {
  it('passes the required tool choice through for provider middleware to adapt', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'exec-codex-tool-choice');
    const base = makeStrategistParameters();

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async () => {
      await ctx.execute('test-step-codex', {});
    });

    expect(stc).toHaveBeenCalledWith(expect.objectContaining({ toolChoice: 'required' }), ctx);
  });

  it('routes one execution to the active root sink, the seat totals, and the ExecuteTokenOutput', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'exec-tokens-1');
    const base = makeStrategistParameters();
    const tokenOutput = { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 };

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async run => {
      const result = await ctx.execute('test-step-a', {}, undefined, tokenOutput);
      expect(result).toBe('done');
      expect(run.tokens.inputTokens).toBe(100);
      expect(run.tokens.reasoningTokens).toBe(10);
    });

    expect(tokenOutput.inputTokens).toBe(100);
    expect(tokenOutput.reasoningTokens).toBe(10);
    expect(ctx.inputTokens).toBe(100); // seat total
    expect(ctx.reasoningTokens).toBe(10);
  });

  it('accrues nested executions into the same root sink (and the seat total)', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'exec-tokens-nested');
    const base = makeStrategistParameters();

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async run => {
      await ctx.execute('test-nesting', { kind: 'parent-input' });
      // The nested child step (100) plus the parent's own step (100) both land in this root.
      expect(run.tokens.inputTokens).toBe(200);
      expect(run.tokens.reasoningTokens).toBe(20);
    });

    expect(ctx.inputTokens).toBe(200);
  });

  it('keeps concurrent roots’ token sinks independent', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'exec-tokens-concurrent');
    const base = makeStrategistParameters();
    const tokensA: number[] = [], tokensB: number[] = [];

    await Promise.all([
      ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async run => {
        await ctx.execute('test-step-a', {});
        tokensA.push(run.tokens.inputTokens);
      }),
      ctx.withRun({ parameters: base, overrides: { turn: 2 } }, async run => {
        await ctx.execute('test-step-b', {});
        tokensB.push(run.tokens.inputTokens);
      }),
    ]);

    expect(tokensA).toEqual([100]);
    expect(tokensB).toEqual([100]);
    expect(ctx.inputTokens).toBe(200); // seat total is the sum of both roots
  });
});

describe('VoxContext continuation nudges', () => {
  it('uses the active tools resolved after prepareStep for the continuation nudge', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'exec-dynamic-nudge');
    const base = makeStrategistParameters();

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async () => {
      await ctx.execute('test-dynamic-nudge', {});
    });

    expect(stc).toHaveBeenCalledTimes(2);
    const continuation = stc.mock.calls[1]![0] as any;
    expect(continuation.activeTools).toEqual(['finish-b']);
    // prepareStep's rescue stays ahead of the nudge appended after the tools were resolved.
    expect(continuation.messages.at(-2).content).toBe(buildRescuePrompt('required'));
    expect(continuation.messages.at(-1)).toEqual({
      role: 'user',
      content: buildCompletionToolsNudge(['finish-b']),
    });
    expect(continuation.messages.at(-1).content).not.toContain('finish-a');
  });

  it('does not repeat a nudge that is already the last message', async () => {
    // A step that called a tool skips prepareStep's empty-response rescue, and one that returns no
    // response messages leaves the nudge trailing — the only shape where the dedup guard is load-bearing.
    stc.mockImplementation(async () => ({
      steps: [{
        text: '',
        usage: { inputTokens: 100, reasoningTokens: 10, outputTokens: 20 },
        response: { messages: [] },
        toolCalls: [{ toolName: 'finish-a' }],
        toolResults: [],
      }],
      text: '',
    }) as any);
    const ctx = new VoxContext<StrategistParameters>({}, 'exec-repeat-nudge');
    const base = makeStrategistParameters();

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async () => {
      await ctx.execute('test-repeat-nudge', {});
    });

    expect(stc).toHaveBeenCalledTimes(3);
    const nudge = buildCompletionToolsNudge(['finish-a']);
    const third = stc.mock.calls[2]![0] as any;
    expect(third.messages.filter((m: any) => m.content === nudge)).toHaveLength(1);
  });
});

describe('VoxContext Codex thread continuation', () => {
  it('threads the previous Codex response id into the next step provider options', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'exec-codex-thread');
    const base = makeStrategistParameters();

    // Each mocked step reports a distinct proxy response id on its response.
    let call = 0;
    stc.mockImplementation(async () => {
      call++;
      const result = fakeResult(`codex step ${call}`);
      result.steps[0].response.id = call === 1 ? 'chatcmpl_codex_step1' : 'chatcmpl_codex_step2';
      return result;
    });

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async () => {
      await ctx.execute('test-codex-thread', {});
    });

    expect(stc).toHaveBeenCalledTimes(2);
    expect(bpo).toHaveBeenCalledTimes(2);
    expect(bpo.mock.calls[0]![2]).toBeUndefined();
    expect(bpo.mock.calls[1]![2]).toBe('chatcmpl_codex_step1');
  });

  it('never threads a selector for a non-Codex provider, even when the response carries an id', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'exec-thread-non-codex');
    const base = makeStrategistParameters();

    // The mocked response carries an id, but a 'test' provider must never consume it.
    stc.mockImplementation(async () => {
      const result = fakeResult('plain step');
      result.steps[0].response.id = 'chatcmpl_ignored';
      return result;
    });

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async () => {
      await ctx.execute('test-two-step', {});
    });

    expect(stc).toHaveBeenCalledTimes(2);
    expect(bpo).toHaveBeenCalledTimes(2);
    expect(bpo.mock.calls[0]![2]).toBeUndefined();
    expect(bpo.mock.calls[1]![2]).toBeUndefined();
  });
});

describe('VoxContext.execute diplomacy-only guard', () => {
  it('rejects a diplomacy-only agent unless the input is a diplomacy thread, before any model step', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'exec-diplomacy-only-reject');
    const base = makeStrategistParameters();

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async () => {
      await expect(ctx.execute('test-diplomacy-only', { diplomacy: false }))
        .rejects.toThrow(/only runs in diplomacy mode/i);
      await expect(ctx.execute('test-diplomacy-only', {}))
        .rejects.toThrow(/only runs in diplomacy mode/i);
    });

    expect(stc).not.toHaveBeenCalled(); // the guard fails fast, before the step loop runs the model
  });

  it('runs a diplomacy-only agent when the input carries the diplomacy flag', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'exec-diplomacy-only-run');
    const base = makeStrategistParameters();

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async () => {
      const result = await ctx.execute('test-diplomacy-only', { diplomacy: true });
      expect(result).toBe('done');
    });

    expect(stc).toHaveBeenCalledTimes(1);
  });
});

describe('VoxContext.execute cancellation isolation', () => {
  it('aborts one root mid-step while the concurrent root’s step completes unaffected', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'exec-abort-mid-step');
    const base = makeStrategistParameters();
    const arrived: Record<number, ReturnType<typeof deferred>> = { 100: deferred(), 200: deferred() };
    const gate: Record<number, ReturnType<typeof deferred>> = { 100: deferred(), 200: deferred() };

    stc.mockImplementation(async (params: any) => {
      const turn = params.experimental_context.turn as number;
      arrived[turn].resolve();
      await gate[turn].promise;
      return fakeResult();
    });

    let hA!: { signal: AbortSignal; abort(): void }, hB!: { signal: AbortSignal };
    const pA = ctx.withRun({ parameters: base, overrides: { turn: 100 } }, async run => {
      hA = run;
      return ctx.execute('test-step-a', {}, undefined, undefined, undefined, { throwOnError: false });
    });
    const pB = ctx.withRun({ parameters: base, overrides: { turn: 200 } }, async run => {
      hB = run;
      return ctx.execute('test-step-b', {});
    });

    // Hold both executions inside the model step.
    await Promise.all([arrived[100].promise, arrived[200].promise]);

    hA.abort();
    expect(hA.signal.aborted).toBe(true);
    expect(hB.signal.aborted).toBe(false);

    gate[100].resolve();
    gate[200].resolve();
    const [rA, rB] = await Promise.all([pA, pB]);

    expect(hB.signal.aborted).toBe(false); // B never observed the abort
    expect(rB).toBe('done');               // B completed normally
    expect(rA).toBeUndefined();            // A's step threw on the aborted signal → execute returned undefined
    expect(ctx.inputTokens).toBe(100);     // only B accrued tokens (A aborted before accrual)
  });
});

describe('VoxContext.shutdown', () => {
  beforeEach(() => {
    vi.spyOn(spanProcessor, 'forceFlush').mockResolvedValue(undefined as any);
    vi.spyOn(VoxSpanExporter.getInstance(), 'closeContext').mockResolvedValue(undefined as any);
  });

  it('rejects new runs once shutdown begins and closes baseParameters exactly once', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'shutdown-basic');
    const close = vi.fn().mockResolvedValue(undefined);
    const base = makeStrategistParameters({ close });
    ctx.setBaseParameters(base);

    await ctx.shutdown();

    expect(close).toHaveBeenCalledTimes(1);
    await expect(ctx.withRun({ parameters: base }, async () => 'x')).rejects.toThrow(/shutting down/);
  });

  it('closes baseParameters and marks closing even if a telemetry flush throws', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'shutdown-flush-throws');
    const close = vi.fn().mockResolvedValue(undefined);
    ctx.setBaseParameters(makeStrategistParameters({ close }));
    // Force the telemetry flush to fail partway through shutdown.
    vi.spyOn(spanProcessor, 'forceFlush').mockRejectedValueOnce(new Error('flush boom'));

    await expect(ctx.shutdown()).rejects.toThrow('flush boom');

    // Cleanup is unconditional: the base parameters were still closed exactly once...
    expect(close).toHaveBeenCalledTimes(1);
    // ...and the context still rejects new runs (closing flag was set before the throw).
    await expect(ctx.withRun({ overrides: { turn: 1 } }, async () => 'x')).rejects.toThrow(/shutting down/);
  });

  it('aborts pending roots and proceeds without waiting for them to unwind', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'shutdown-pending');
    const close = vi.fn().mockResolvedValue(undefined);
    ctx.setBaseParameters(makeStrategistParameters({ close }));

    let stuck!: { signal: AbortSignal };
    // A root that ignores its abort signal and never settles.
    void ctx.withRun({ overrides: { turn: 1 } }, async run => {
      stuck = run;
      await new Promise<void>(() => {});
    });
    await Promise.resolve(); // let withRun register the root + start the callback

    await ctx.shutdown(); // resolves immediately despite the still-pending root

    expect(stuck.signal.aborted).toBe(true); // shutdown aborted the root
    expect(close).toHaveBeenCalledTimes(1);  // base parameters closed exactly once
  });
});
