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
import { spanProcessor } from '../../../src/instrumentation.js';
import { VoxSpanExporter } from '../../../src/utils/telemetry/vox-exporter.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import { makeStrategistParameters } from '../../helpers/fake-vox-context.js';
import type { Model } from '../../../src/types/index.js';

const stc = vi.mocked(streamTextWithConcurrency);

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

/** Agent that performs a nested execute() inside its initial-message hook, then runs its own step. */
class NestingAgent extends VoxAgent<StrategistParameters> {
  readonly description = 'nesting test agent';
  constructor(public readonly name: string, private readonly child: string) { super(); }
  override getModel(): Model { return { provider: 'test', name: 'test' } as Model; }
  async getSystem(): Promise<string> { return 'system'; }
  override getActiveTools(): string[] { return []; }
  override stopCheck(): boolean { return true; }
  override async getInitialMessages(p: StrategistParameters, _i: unknown, ctx: VoxContext<StrategistParameters>) {
    await ctx.execute(this.child, p, { kind: 'child-input' });
    return [];
  }
}

beforeAll(() => {
  agentRegistry.register(new StepAgent('test-step-a') as any);
  agentRegistry.register(new StepAgent('test-step-b') as any);
  agentRegistry.register(new StepAgent('test-step-child') as any);
  agentRegistry.register(new NestingAgent('test-nesting', 'test-step-child') as any);
});

beforeEach(() => {
  stc.mockReset();
  stc.mockImplementation(async () => fakeResult());
});

describe('VoxContext.execute token accounting', () => {
  it('routes one execution to the active root sink, the seat totals, and the ExecuteTokenOutput', async () => {
    const ctx = new VoxContext<StrategistParameters>({}, 'exec-tokens-1');
    const base = makeStrategistParameters();
    const tokenOutput = { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 };

    await ctx.withRun({ parameters: base, overrides: { turn: 1 } }, async run => {
      const result = await ctx.execute('test-step-a', base, {}, undefined, tokenOutput);
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
      await ctx.execute('test-nesting', base, { kind: 'parent-input' });
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
        await ctx.execute('test-step-a', base, {});
        tokensA.push(run.tokens.inputTokens);
      }),
      ctx.withRun({ parameters: base, overrides: { turn: 2 } }, async run => {
        await ctx.execute('test-step-b', base, {});
        tokensB.push(run.tokens.inputTokens);
      }),
    ]);

    expect(tokensA).toEqual([100]);
    expect(tokensB).toEqual([100]);
    expect(ctx.inputTokens).toBe(200); // seat total is the sum of both roots
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
      return ctx.execute('test-step-a', base, {}, undefined, undefined, undefined, { throwOnError: false });
    });
    const pB = ctx.withRun({ parameters: base, overrides: { turn: 200 } }, async run => {
      hB = run;
      return ctx.execute('test-step-b', base, {});
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
