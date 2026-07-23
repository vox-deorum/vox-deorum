/**
 * @module utils/telemetry/provider-tool-spans
 *
 * Surfaces provider-executed built-in tool calls as Vox Deorum telemetry spans.
 *
 * Claude Code and Codex run host tools outside the AI SDK tool-execution path
 * that produces the existing `mcp-tool.*` spans. Their providers surface each
 * call as `providerExecuted` content parts. This helper reads the final step
 * content and emits one retrospective point-in-time span per call.
 *
 * These are NOT timed wrappers: the tools already ran inside the CLI, so each
 * span is opened and immediately ended purely to record the call/result.
 * Middleware-synthesized prompt-mode game-tool parts are never
 * `providerExecuted`, so the two populations are cleanly separable.
 *
 * Known limitation (retry attempts): we read only the last `StepResult` of the
 * attempt that ultimately succeeded (`streamTextWithConcurrency` re-runs the
 * whole `streamText` call on failure). Built-in tools that ran inside a retry
 * attempt whose stream later threw leave no `StepResult.content` to read here,
 * so their spans are not emitted, and a retried attempt re-runs them (relevant
 * for side-effecting built-ins like Write/Edit, not the read-only defaults).
 * Capturing those would require accumulating tool-result parts mid-stream in the
 * provider-agnostic concurrency wrapper, which is out of scope for this span
 * helper; the normal (no-retry) path is fully covered.
 */

import { SpanKind, SpanStatusCode, type Tracer } from '@opentelemetry/api';

/**
 * A CLI-executed tool part as it appears on `StepResult.content`. Only the
 * fields we consume are typed; the AI-SDK part carries more.
 */
interface ProviderExecutedToolPart {
  type: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  providerExecuted?: boolean;
  preliminary?: boolean;
}

/** Providers whose built-in activity is normalized into AI SDK content parts. */
export type BuiltInToolProvider = 'claude-code' | 'codex';

/** Test whether a structured result reports a provider-side failure. */
function isFailedOutput(output: unknown): boolean {
  return typeof output === 'object'
    && output !== null
    && 'status' in output
    && output.status === 'failed';
}

/** Test whether structured provider output is a non-terminal progress update. */
function isPreliminaryOutput(output: unknown): boolean {
  if (typeof output !== 'object' || output === null || !('status' in output)) return false;
  return output.status === 'pending'
    || output.status === 'started'
    || output.status === 'in_progress'
    || output.status === 'in-progress';
}

/** Serialize a telemetry value without collapsing structured data to a generic string. */
function serializeValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Walk a step's `content` parts and emit one span per CLI-executed built-in
 * tool call, pairing each `providerExecuted` `tool-call` with its matching
 * `tool-result`/`tool-error` by `toolCallId`.
 *
 * @param content - `StepResult.content` (read here, not `response.messages`,
 *   which structurally drops `providerExecuted` from tool-results and re-wraps
 *   the output in a `{type:'json',value}` envelope).
 * @param tracer - Tracer to open spans on. Spans parent under whatever span is
 *   active in the current OTel context (the enclosing step span at the call site).
 * @param attributes - Context identity (`contextId`) and the current game turn.
 * @returns The number of spans emitted.
 */
export function emitProviderExecutedToolSpans(
  provider: BuiltInToolProvider,
  content: unknown,
  tracer: Tracer,
  attributes: { contextId: string; turn: unknown }
): number {
  if (!Array.isArray(content)) return 0;
  const parts = content as ProviderExecutedToolPart[];

  // Index CLI-executed results/errors by call id so each call finds its outcome.
  const resultsById = new Map<string, ProviderExecutedToolPart>();
  for (const part of parts) {
    if (
      (part?.type === 'tool-result' || part?.type === 'tool-error') &&
      part.providerExecuted === true &&
      part.preliminary !== true &&
      !isPreliminaryOutput(part.output) &&
      typeof part.toolCallId === 'string'
    ) {
      resultsById.set(part.toolCallId, part);
    }
  }

  let emitted = 0;
  for (const call of parts) {
    if (call?.type !== 'tool-call' || call.providerExecuted !== true) continue;

    const toolName = call.toolName ?? 'unknown';
    const result = typeof call.toolCallId === 'string' ? resultsById.get(call.toolCallId) : undefined;

    const span = tracer.startSpan(`${provider}-tool.${toolName}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        'tool.name': toolName,
        'tool.type': `${provider}-builtin`,
        'vox.context.id': attributes.contextId,
        'game.turn': String(attributes.turn),
        'tool.input': JSON.stringify(call.input),
      },
    });

    try {
      // AI-SDK core converts every provider tool-result with `isError: true`
      // into a `tool-error` content part before it reaches `StepResult.content`,
      // so a failing call always arrives as `tool-error` here.
      if (result?.type === 'tool-error' || result?.type === 'tool-result' && isFailedOutput(result.output)) {
        // The provider's serializeToolError() usually stringifies the error, but
        // the raw tool_result + is_error path can surface object/array payloads.
        // Store strings as-is (single-encoding parity with mcp-tool.* spans) and
        // JSON-serialize structured values so they never collapse to "[object Object]".
        const failure = result.type === 'tool-error' ? result.error : result.output;
        const serialized = serializeValue(failure);
        if (serialized !== undefined) span.setAttribute('tool.output', serialized);
        span.setStatus({ code: SpanStatusCode.ERROR, message: `Built-in tool ${toolName} failed` });
      } else if (result?.type === 'tool-result') {
        const serialized = serializeValue(result.output);
        if (serialized !== undefined) span.setAttribute('tool.output', serialized);
        span.setStatus({ code: SpanStatusCode.OK });
      } else {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `Built-in tool ${toolName} ended without a terminal result`,
        });
      }
    } finally {
      span.end();
    }
    emitted++;
  }

  return emitted;
}
