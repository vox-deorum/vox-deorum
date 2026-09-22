/**
 * Unit tests for the shared telemetry primitives in src/infra/vox-telemetry.ts, exercised
 * directly against a minimal ExecutionHost fake: span opening attributes, error recording,
 * token accrual across the root sink / seat totals / per-execution output, and the in-game
 * model label update (short name, VPAI fallback, and the dedupe against the last sent label).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';
import type { Tracer } from '@opentelemetry/api';
import {
  openAgentSpan,
  openStepSpan,
  recordSpanError,
  accrueTokens,
  updateModelLabel,
} from '../../../src/infra/vox-telemetry.js';
import type { ExecutionHost } from '../../../src/infra/vox-telemetry.js';
import type { AgentParameters } from '../../../src/infra/vox-agent.js';
import type { RootRun } from '../../../src/infra/vox-run.js';
import type { Model } from '../../../src/types/index.js';
import { createLogger } from '../../../src/utils/logger.js';
import { makeRecordingTracer } from '../../helpers/recording-tracer.js';

/** The seat token totals carried by an ExecutionHost fake. */
interface FakeHostTotals {
  inputTokens: number;
  reasoningTokens: number;
  outputTokens: number;
}

/**
 * A minimal ExecutionHost fake carrying only the state the telemetry helpers and the evaluate
 * path touch. That it fits in a handful of lines is the point: ExecutionHost is meant to stay
 * this narrow. The run accessors are inert here (no helper reads them beyond type shape).
 */
function makeHost(tracer: Tracer = makeRecordingTracer().tracer): ExecutionHost<AgentParameters> & FakeHostTotals {
  return {
    id: 'telemetry-test',
    tracer,
    logger: createLogger('telemetry-test'),
    activeRoot: undefined,
    currentSignal: () => new AbortController().signal,
    timeoutRefresh: undefined,
    inputTokens: 0,
    reasoningTokens: 0,
    outputTokens: 0,
    lastModelName: undefined,
    callTool: vi.fn(async () => undefined),
  };
}

/** A root run fake with an empty token sink (accrueTokens only writes to root.tokens). */
function makeRoot(): RootRun<AgentParameters> {
  return {
    tokens: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0 },
  } as unknown as RootRun<AgentParameters>;
}

describe('openAgentSpan', () => {
  it('should carry the context id, turn, agent name, and serialized input', () => {
    const { tracer, spans } = makeRecordingTracer();
    const host = makeHost(tracer);

    openAgentSpan(host, 'diplomat', 7, { kind: 'thread' });

    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe('agent.diplomat');
    expect(spans[0]!.attributes).toEqual({
      'vox.context.id': 'telemetry-test',
      'game.turn': '7',
      'agent.name': 'diplomat',
      'agent.input': '{"kind":"thread"}',
    });
  });

  it('should leave agent.input undefined for falsy input', () => {
    const { tracer, spans } = makeRecordingTracer();
    const host = makeHost(tracer);

    openAgentSpan(host, 'simple-strategist', 1, undefined);

    expect(spans[0]!.attributes['agent.input']).toBeUndefined();
  });
});

describe('openStepSpan', () => {
  it('should name the span by agent and 1-based step number with the standard attributes', () => {
    const { tracer, spans } = makeRecordingTracer();
    const host = makeHost(tracer);

    openStepSpan(host, 'simple-strategist', 4, 2);

    expect(spans[0]!.name).toBe('agent.simple-strategist.step.2');
    expect(spans[0]!.attributes).toEqual({
      'vox.context.id': 'telemetry-test',
      'game.turn': '4',
      'agent.name': 'simple-strategist',
      'step.number': 2,
    });
  });
});

describe('recordSpanError', () => {
  it('should record the exception and mark the span ERROR with the message', () => {
    const span = recordSpanErrorTarget();

    recordSpanError(span as any, new Error('boom'));

    expect(span.exception).toBeInstanceOf(Error);
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: 'boom' });
    expect(span.ended).toBe(false);
  });

  it('should stringify a non-Error thrown value', () => {
    const span = recordSpanErrorTarget();

    recordSpanError(span as any, 'plain failure');

    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: 'plain failure' });
  });
});

describe('accrueTokens', () => {
  it('should sum usage into the root sink and the seat-wide totals', () => {
    const host = makeHost();
    const root = makeRoot();

    accrueTokens(host, root, { inputTokens: 100, reasoningTokens: 10, outputTokens: 5 });
    accrueTokens(host, root, { inputTokens: 1, reasoningTokens: 2, outputTokens: 3 });

    expect(root.tokens).toEqual({ inputTokens: 101, reasoningTokens: 12, outputTokens: 8 });
    expect({
      inputTokens: host.inputTokens,
      reasoningTokens: host.reasoningTokens,
      outputTokens: host.outputTokens,
    }).toEqual({ inputTokens: 101, reasoningTokens: 12, outputTokens: 8 });
  });

  it('should assign (not add) the optional per-execution token output', () => {
    const host = makeHost();
    const root = makeRoot();
    const tokenOutput = { inputTokens: 999, reasoningTokens: 999, outputTokens: 999 };

    accrueTokens(host, root, { inputTokens: 10, reasoningTokens: 1, outputTokens: 2 }, tokenOutput);

    expect(tokenOutput).toEqual({ inputTokens: 10, reasoningTokens: 1, outputTokens: 2 });
  });

  it('should tolerate a missing token output', () => {
    const host = makeHost();
    const root = makeRoot();

    expect(() =>
      accrueTokens(host, root, { inputTokens: 1, reasoningTokens: 1, outputTokens: 1 })
    ).not.toThrow();
  });
});

describe('updateModelLabel', () => {
  const params = { playerID: 3 } as AgentParameters;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should send the model short name for a strategist with a system prompt', async () => {
    const host = makeHost();
    const model = { provider: 'codex', name: 'codex/gpt-5.6-luna' } as Model;

    await updateModelLabel(host, 'simple-strategist', model, 'system', params);

    expect(host.callTool).toHaveBeenCalledWith(
      'set-metadata',
      { Key: 'model-3', Value: 'gpt-5.6-luna' },
      params
    );
    expect(host.lastModelName).toBe('gpt-5.6-luna');
  });

  it('should send VPAI when the system prompt is empty', async () => {
    const host = makeHost();
    const model = { provider: 'codex', name: 'codex/gpt-5.6-luna' } as Model;

    await updateModelLabel(host, 'simple-strategist', model, '', params);

    expect(host.callTool).toHaveBeenCalledWith(
      'set-metadata',
      { Key: 'model-3', Value: 'VPAI' },
      params
    );
  });

  it('should skip the send when the label is unchanged', async () => {
    const host = makeHost();
    host.lastModelName = 'gpt-5.6-luna';
    const model = { provider: 'codex', name: 'codex/gpt-5.6-luna' } as Model;

    await updateModelLabel(host, 'simple-strategist', model, 'system', params);

    expect(host.callTool).not.toHaveBeenCalled();
  });

  it('should stay silent for non-strategist agents', async () => {
    const host = makeHost();
    const model = { provider: 'codex', name: 'codex/gpt-5.6-luna' } as Model;

    await updateModelLabel(host, 'diplomat', model, 'system', params);

    expect(host.callTool).not.toHaveBeenCalled();
  });
});

/** Build one recording fake span for the recordSpanError tests. */
function recordSpanErrorTarget() {
  const { tracer, spans } = makeRecordingTracer();
  tracer.startSpan('probe');
  return spans[0]!;
}
