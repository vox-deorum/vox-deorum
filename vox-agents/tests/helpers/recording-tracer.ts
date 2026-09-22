/**
 * A recording OpenTelemetry tracer fake for the execution tests.
 *
 * Spans come back as plain mutable objects that keep exactly the attributes, status, exception,
 * and end flag the production code sets on them, so a test can assert the full span contract
 * without a real exporter. The real `trace.setSpan`/`context.with` plumbing still runs against
 * these spans, so parenting behaves as it does in production.
 */

import type { Tracer } from '@opentelemetry/api';

/** One span captured by the recording tracer, exposing everything the production code mutates. */
export interface FakeSpan {
  name: string;
  attributes: Record<string, unknown>;
  status?: { code: number; message?: string };
  exception?: unknown;
  ended: boolean;
}

/** Build a tracer that records every started span and returns mutable span objects. */
export function makeRecordingTracer(): { tracer: Tracer; spans: FakeSpan[] } {
  const spans: FakeSpan[] = [];
  const tracer = {
    startSpan: (name: string, options?: { attributes?: Record<string, unknown> }) => {
      const span = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
        status: undefined,
        exception: undefined,
        ended: false,
        setAttributes: (attrs: Record<string, unknown>) => { Object.assign(span.attributes, attrs); },
        setAttribute: (key: string, value: unknown) => { span.attributes[key] = value; },
        setStatus: (status: { code: number; message?: string }) => { span.status = status; },
        recordException: (error: unknown) => { span.exception = error; },
        end: () => { span.ended = true; },
      } as any;
      spans.push(span);
      return span;
    },
  };
  return { tracer: tracer as unknown as Tracer, spans };
}

/**
 * Swap a context's tracer for a recording fake and hand back the list it fills. Use this on a
 * VoxContext (or anything else carrying a `tracer`) before driving the code under test.
 */
export function recordSpans(target: { tracer: Tracer }): FakeSpan[] {
  const { tracer, spans } = makeRecordingTracer();
  target.tracer = tracer;
  return spans;
}
