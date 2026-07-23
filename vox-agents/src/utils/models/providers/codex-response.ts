/**
 * Normalizes Codex rc.3 built-in activity from the proxy's raw compatible
 * response into AI SDK provider-executed dynamic tool parts.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3Middleware,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';

/** A non-retryable protocol violation from the pinned Codex proxy. */
export class CodexProviderProtocolError extends Error {
  /** Keep deterministic response-shape failures out of the retry loop. */
  readonly isRetryable = false;

  /** Create a provider protocol error with an operation-specific reason. */
  constructor(message: string) {
    super(message);
    this.name = 'CodexProviderProtocolError';
  }
}

/** One parsed built-in activity call tracked across raw response chunks. */
type ActivityCall = {
  id: string;
  toolName: string;
  input: string;
  announced: boolean;
  preliminary: boolean;
  finished: boolean;
};

/** A declared-name raw call held until its lifecycle proves its execution owner. */
type PendingCandidate = {
  id: string;
  toolName: string;
  input: string;
  bufferedParts: LanguageModelV3StreamPart[];
};

/** Loose representation of the proxy's raw function call shape. */
type RawToolCall = {
  id?: unknown;
  index?: unknown;
  function?: { name?: unknown; arguments?: unknown };
};

/** Loose representation of the proxy's rc.3 activity result shape. */
type RawToolResult = {
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
  result?: unknown;
};

/** Keeps each transformed stream request's caller raw-chunk preference private. */
const rawChunkPreferences = new WeakMap<LanguageModelV3CallOptions, boolean>();

/** Deterministic continuation failures that cannot succeed on an outer model retry. */
const terminalContinuationCodes = new Set([
  'ambiguous_tool_call_id',
  'duplicate_tool_call_id',
  'expired_tool_continuation',
  'thread_not_resumable',
  'tool_results_required',
  'tool_results_without_pending_call',
  'unknown_tool_call_id',
]);

/** Return a record only for object values that can safely be inspected. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Return a non-retryable error with a consistent proxy-protocol prefix. */
function protocolError(reason: string): CodexProviderProtocolError {
  return new CodexProviderProtocolError(`Codex proxy activity protocol error: ${reason}.`);
}

/** Extract the proxy's stable error code from an AI SDK API-call failure. */
function proxyErrorCode(error: unknown): string | undefined {
  const record = asRecord(error);
  const dataError = asRecord(asRecord(record?.data)?.error);
  if (typeof dataError?.code === 'string') return dataError.code;
  if (typeof record?.responseBody !== 'string') return undefined;
  try {
    const bodyError = asRecord(asRecord(JSON.parse(record.responseBody) as unknown)?.error);
    return typeof bodyError?.code === 'string' ? bodyError.code : undefined;
  } catch {
    return undefined;
  }
}

/** Mark deterministic proxy continuation failures as terminal for Vox Deorum's retry layer. */
function classifyContinuationFailure(error: unknown): never {
  const code = proxyErrorCode(error);
  if (
    code !== undefined
    && (terminalContinuationCodes.has(code) || /^continuation_.+_mismatch$/.test(code))
    && asRecord(error) !== undefined
  ) {
    (error as { isRetryable?: boolean }).isRetryable = false;
  }
  throw error;
}

/** Execute one adapter operation while preserving and refining its retry classification. */
async function withContinuationClassification<T>(operation: () => PromiseLike<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return classifyContinuationFailure(error);
  }
}

/** Return whether a value is a JSON value accepted by an AI SDK tool result. */
function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  const record = asRecord(value);
  return record !== undefined && Object.values(record).every(isJsonValue);
}

/** Return a parsed JSON object input or fail closed on malformed proxy arguments. */
function requireObjectInput(value: unknown, context: string): string {
  if (typeof value !== 'string') throw protocolError(`${context} has non-string function arguments`);
  try {
    const parsed = JSON.parse(value) as unknown;
    if (asRecord(parsed) === undefined) throw new Error('not an object');
  } catch {
    throw protocolError(`${context} has invalid function arguments`);
  }
  return value;
}

/** Return whether a partial streamed function input has become a JSON object. */
function hasObjectInput(value: string): boolean {
  try {
    return asRecord(JSON.parse(value) as unknown) !== undefined;
  } catch {
    return false;
  }
}

/** Return the declared client function names for collision classification. */
function declaredFunctionNames(params: LanguageModelV3CallOptions): Set<string> {
  return new Set((params.tools ?? [])
    .filter((tool): tool is Extract<typeof tool, { type: 'function' }> => tool.type === 'function')
    .map((tool) => tool.name));
}

/** Remove provider-executed activity from prompt replay while retaining mixed client history. */
function stripProviderActivityHistory(params: LanguageModelV3CallOptions): LanguageModelV3CallOptions {
  const providerIds = new Set<string>();
  for (const message of params.prompt) {
    if (message.role !== 'assistant') continue;
    for (const part of message.content) {
      if (part.type === 'tool-call' && part.providerExecuted) providerIds.add(part.toolCallId);
    }
  }
  if (providerIds.size === 0) return params;

  const prompt = params.prompt.reduce<LanguageModelV3CallOptions['prompt']>((filtered, message) => {
    if (message.role !== 'assistant' && message.role !== 'tool') {
      filtered.push(message);
      return filtered;
    }
    const content = message.content.filter((part) => {
      if (part.type === 'tool-call') return !part.providerExecuted;
      return part.type !== 'tool-result' || !providerIds.has(part.toolCallId);
    });
    if (content.length > 0) filtered.push({ ...message, content } as typeof message);
    return filtered;
  }, []);
  return { ...params, prompt };
}

/** Extract a chat-completion choice delta or message from a raw adapter body. */
function rawChoicePayload(raw: unknown): Record<string, unknown> | undefined {
  const choices = asRecord(raw)?.choices;
  if (!Array.isArray(choices)) return undefined;
  const choice = asRecord(choices[0]);
  return asRecord(choice?.delta) ?? asRecord(choice?.message);
}

/** Return the raw Chat Completions finish reason carried by one SSE frame. */
function rawFinishReason(raw: unknown): string | undefined {
  const choices = asRecord(raw)?.choices;
  if (!Array.isArray(choices)) return undefined;
  const value = asRecord(choices[0])?.finish_reason;
  return typeof value === 'string' ? value : undefined;
}

/** Translate the proxy's lifecycle statuses to preliminary or final result state. */
function activityStatus(status: unknown): { preliminary: boolean; failed: boolean } {
  if (status === 'pending' || status === 'started' || status === 'in_progress' || status === 'in-progress') {
    return { preliminary: true, failed: false };
  }
  if (status === 'completed') return { preliminary: false, failed: false };
  if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled' || status === 'interrupted') {
    return { preliminary: false, failed: true };
  }
  throw protocolError(`tool result has unsupported status '${String(status)}'`);
}

/** Coordinates raw activity calls with adapter-owned client function calls. */
class ActivityNormalizer {
  private readonly declaredNames: Set<string>;
  private readonly calls = new Map<string, ActivityCall>();
  private readonly callIdsByIndex = new Map<number, string>();
  private readonly clientCallIds = new Set<string>();
  private readonly clientCallIdsByIndex = new Map<number, string>();
  private readonly pendingCandidates = new Map<string, PendingCandidate>();
  private readonly pendingCandidateIdsByIndex = new Map<number, string>();

  /** Create a response-local normalizer with the request's declared client functions. */
  constructor(params: LanguageModelV3CallOptions) {
    this.declaredNames = declaredFunctionNames(params);
  }

  /** Classify raw tool calls and emit only confirmed provider-executed activity calls. */
  ingestCalls(rawCalls: unknown): LanguageModelV3StreamPart[] {
    if (rawCalls === undefined) return [];
    if (!Array.isArray(rawCalls)) throw protocolError('tool_calls is not an array');
    const parts: LanguageModelV3StreamPart[] = [];
    for (const candidate of rawCalls) {
      const call = asRecord(candidate) as RawToolCall | undefined;
      const functionValue = asRecord(call?.function);
      const name = functionValue?.name;
      const index = typeof call?.index === 'number' && Number.isInteger(call.index) ? call.index : undefined;
      let id = typeof call?.id === 'string' && call.id.length > 0 ? call.id : undefined;
      if (!id && index !== undefined) id = this.callIdsByIndex.get(index);
      if (!id && index !== undefined) id = this.pendingCandidateIdsByIndex.get(index);
      if (!id && index !== undefined) id = this.clientCallIdsByIndex.get(index);
      if (!id) throw protocolError('tool call has no stable call ID');

      const existing = this.calls.get(id);
      if (existing) {
        if (typeof name === 'string' && this.declaredNames.has(name)) {
          throw protocolError(`client tool '${name}' collides with activity call ID '${id}'`);
        }
        if (name !== undefined && name !== existing.toolName) throw protocolError(`activity call '${id}' changes its function name`);
        const argumentsDelta = functionValue?.arguments;
        if (argumentsDelta !== undefined && typeof argumentsDelta !== 'string') throw protocolError(`tool call '${id}' has non-string function arguments`);
        if (argumentsDelta && existing.announced) throw protocolError(`duplicate activity call '${id}'`);
        if (argumentsDelta) existing.input += argumentsDelta;
        if (!existing.announced && hasObjectInput(existing.input)) {
          existing.announced = true;
          parts.push({ type: 'tool-call', toolCallId: id, toolName: existing.toolName, input: existing.input, providerExecuted: true, dynamic: true });
        }
        continue;
      }
      const pendingCandidate = this.pendingCandidates.get(id);
      if (pendingCandidate) {
        if (name !== undefined && name !== pendingCandidate.toolName) throw protocolError(`declared tool call '${id}' changes its function name`);
        const argumentsDelta = functionValue?.arguments;
        if (argumentsDelta !== undefined && typeof argumentsDelta !== 'string') throw protocolError(`tool call '${id}' has non-string function arguments`);
        if (argumentsDelta) pendingCandidate.input += argumentsDelta;
        continue;
      }
      if (this.clientCallIds.has(id)) {
        if (typeof name === 'string' && !this.declaredNames.has(name)) {
          throw protocolError(`activity tool '${name}' collides with client call ID '${id}'`);
        }
        continue;
      }
      if (typeof name !== 'string' || name.length === 0) throw protocolError('tool call has no function name');
      if (this.declaredNames.has(name)) {
        if (typeof functionValue?.arguments !== 'string') throw protocolError(`tool call '${id}' has non-string function arguments`);
        this.pendingCandidates.set(id, { id, toolName: name, input: functionValue.arguments, bufferedParts: [] });
        if (index !== undefined) this.pendingCandidateIdsByIndex.set(index, id);
        continue;
      }
      if (this.clientCallIds.has(id)) throw protocolError(`activity tool '${name}' collides with client call ID '${id}'`);
      if (index !== undefined) this.callIdsByIndex.set(index, id);

      if (typeof functionValue?.arguments !== 'string') throw protocolError(`tool call '${id}' has non-string function arguments`);
      const activity: ActivityCall = { id, toolName: name, input: functionValue.arguments, announced: false, preliminary: false, finished: false };
      this.calls.set(id, activity);
      if (hasObjectInput(activity.input)) {
        activity.announced = true;
        parts.push({ type: 'tool-call', toolCallId: id, toolName: name, input: activity.input, providerExecuted: true, dynamic: true });
      }
    }
    return parts;
  }

  /** Normalize raw rc.3 activity results after verifying their unique call correlation. */
  ingestResults(rawResults: unknown): LanguageModelV3StreamPart[] {
    if (rawResults === undefined) return [];
    if (!Array.isArray(rawResults)) throw protocolError('tool_results is not an array');
    const parts: LanguageModelV3StreamPart[] = [];
    for (const rawCandidate of rawResults) {
      const raw = asRecord(rawCandidate) as RawToolResult | undefined;
      const id = raw?.id;
      const functionValue = asRecord(raw?.function);
      const name = functionValue?.name;
      if (typeof id !== 'string' || id.length === 0 || typeof name !== 'string' || name.length === 0) {
        throw protocolError('tool result has malformed call correlation');
      }
      let activity = this.calls.get(id);
      const pendingCandidate = this.pendingCandidates.get(id);
      if (!activity && pendingCandidate) {
        if (pendingCandidate.toolName !== name) throw protocolError(`tool result '${id}' changes its function name`);
        if (!hasObjectInput(pendingCandidate.input)) throw protocolError(`tool result '${id}' arrived before its complete activity call`);
        if (functionValue?.arguments !== undefined && requireObjectInput(functionValue.arguments, `tool result '${id}'`) !== pendingCandidate.input) {
          throw protocolError(`tool result '${id}' changes its function arguments`);
        }
        this.pendingCandidates.delete(id);
        activity = { id, toolName: pendingCandidate.toolName, input: pendingCandidate.input, announced: true, preliminary: false, finished: false };
        this.calls.set(id, activity);
        parts.push({ type: 'tool-call', toolCallId: id, toolName: activity.toolName, input: activity.input, providerExecuted: true, dynamic: true });
      }
      if (!activity) {
        if (this.clientCallIds.has(id) || this.declaredNames.has(name)) throw protocolError(`ambiguous tool result '${id}' for declared function '${name}'`);
        throw protocolError(`orphan activity tool result '${id}'`);
      }
      if (activity.toolName !== name) throw protocolError(`tool result '${id}' changes its function name`);
      if (!activity.announced) throw protocolError(`tool result '${id}' arrived before its complete activity call`);
      if (functionValue?.arguments !== undefined && requireObjectInput(functionValue.arguments, `tool result '${id}'`) !== activity.input) {
        throw protocolError(`tool result '${id}' changes its function arguments`);
      }
      if (activity.finished) throw protocolError(`duplicate terminal activity result '${id}'`);
      const result = asRecord(raw?.result);
      if (!result || typeof result.status !== 'string' || !isJsonValue(result)) throw protocolError(`tool result '${id}' is malformed`);
      const status = activityStatus(result.status);
      if (activity.preliminary && status.preliminary) {
        // Multiple progress updates are valid and replace the prior preliminary state downstream.
      }
      activity.preliminary ||= status.preliminary;
      activity.finished = !status.preliminary;
      parts.push({
        type: 'tool-result',
        toolCallId: id,
        toolName: activity.toolName,
        result: result as any,
        ...(status.preliminary ? { preliminary: true } : {}),
        dynamic: true,
      });
    }
    return parts;
  }

  /** Return the call ID represented by one adapter tool lifecycle part. */
  private adapterCallId(part: LanguageModelV3Content | LanguageModelV3StreamPart): string | undefined {
    if (part.type === 'tool-call') return part.toolCallId;
    if (part.type === 'tool-result') return part.toolCallId;
    if (part.type === 'tool-input-start' || part.type === 'tool-input-delta' || part.type === 'tool-input-end') return part.id;
    return undefined;
  }

  /** Buffer declared-name adapter lifecycle until raw activity or the terminal client finish classifies it. */
  handleAdapterPart(part: LanguageModelV3StreamPart): LanguageModelV3StreamPart[] {
    const id = this.adapterCallId(part);
    if (!id) return [part];
    const candidate = this.pendingCandidates.get(id);
    if (candidate) {
      candidate.bufferedParts.push(part);
      return [];
    }
    return this.calls.has(id) ? [] : [part];
  }

  /** Filter non-stream adapter content after raw classification has completed. */
  keepGeneratedContent(part: LanguageModelV3Content): boolean {
    const id = this.adapterCallId(part);
    return id === undefined || !this.calls.has(id);
  }

  /** Release all pending declared-name candidates as genuine client tool lifecycle parts. */
  releaseClientCandidates(): LanguageModelV3StreamPart[] {
    const parts: LanguageModelV3StreamPart[] = [];
    for (const [id, candidate] of this.pendingCandidates) {
      this.pendingCandidates.delete(id);
      this.clientCallIds.add(id);
      for (const [index, indexedId] of this.pendingCandidateIdsByIndex) {
        if (indexedId === id) {
          this.pendingCandidateIdsByIndex.delete(index);
          this.clientCallIdsByIndex.set(index, id);
        }
      }
      parts.push(...candidate.bufferedParts);
    }
    return parts;
  }

  /** Classify held declared-name calls at an authoritative raw terminal finish. */
  finishRaw(finishReason: string | undefined): LanguageModelV3StreamPart[] {
    if (finishReason === undefined) return [];
    if (this.pendingCandidates.size === 0) return [];
    if (finishReason !== 'tool_calls') throw protocolError('declared tool call ended without a matching result or tool_calls finish');
    return this.releaseClientCandidates();
  }

  /** Finalize a normally completed response, failing only confirmed unfinished preliminary activity. */
  finishNormally(): LanguageModelV3StreamPart[] {
    const parts: LanguageModelV3StreamPart[] = [];
    if (this.pendingCandidates.size > 0) throw protocolError('stream ended before declared tool calls could be classified');
    for (const activity of this.calls.values()) {
      if (activity.finished) continue;
      if (!activity.preliminary || !activity.announced) throw protocolError(`activity call '${activity.id}' ended without a result`);
      activity.finished = true;
      parts.push({
        type: 'tool-result',
        toolCallId: activity.id,
        toolName: activity.toolName,
        result: { status: 'failed', error: { message: 'The Codex built-in activity ended before a final result.' } },
        dynamic: true,
      });
    }
    return parts;
  }

  /** Reject a disconnected stream after activity has started, since replay would be ambiguous. */
  failOnDisconnect(): void {
    if (this.pendingCandidates.size > 0 || this.calls.size > 0) {
      throw protocolError('stream disconnected during built-in activity');
    }
  }
}

/** Normalize Codex raw rc.3 activity while preserving compatible adapter text and reasoning parsing. */
export function codexActivityMiddleware(): LanguageModelV3Middleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      const transformed = {
        ...stripProviderActivityHistory(params),
        // Raw chunks are consumed internally and conditionally forwarded below.
        includeRawChunks: true,
      };
      rawChunkPreferences.set(transformed, params.includeRawChunks === true);
      return transformed;
    },
    wrapGenerate: async ({ doGenerate, params }) => {
      const response = await withContinuationClassification(doGenerate);
      const normalizer = new ActivityNormalizer(params);
      const payload = rawChoicePayload(response.response?.body);
      const activity = [
        ...normalizer.ingestCalls(payload?.tool_calls),
        ...normalizer.ingestResults(payload?.tool_results),
        ...normalizer.finishRaw(response.finishReason.raw),
        ...normalizer.finishNormally(),
      ];
      const content = response.content.filter((part) => normalizer.keepGeneratedContent(part));
      return { ...response, content: [...content, ...activity as LanguageModelV3Content[]] };
    },
    wrapStream: async ({ doStream, params }) => {
      const response = await withContinuationClassification(doStream);
      const normalizer = new ActivityNormalizer(params);
      const requestedRawChunks = rawChunkPreferences.get(params) ?? params.includeRawChunks === true;
      let sawFinish = false;
      let sawRawFinish = false;
      return {
        ...response,
        stream: response.stream.pipeThrough(new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
          transform(part, controller) {
            if (part.type === 'raw') {
              if (requestedRawChunks) controller.enqueue(part);
              const payload = rawChoicePayload(part.rawValue);
              const finishReason = rawFinishReason(part.rawValue);
              if (finishReason !== undefined) sawRawFinish = true;
              for (const activity of normalizer.ingestCalls(payload?.tool_calls)) controller.enqueue(activity);
              for (const activity of normalizer.ingestResults(payload?.tool_results)) controller.enqueue(activity);
              for (const clientPart of normalizer.finishRaw(finishReason)) controller.enqueue(clientPart);
              return;
            }
            if (part.type === 'error') normalizer.failOnDisconnect();
            if (part.type === 'finish') {
              if (!sawRawFinish) normalizer.failOnDisconnect();
              for (const activity of normalizer.finishNormally()) controller.enqueue(activity);
              sawFinish = true;
            }
            for (const normalizedPart of normalizer.handleAdapterPart(part)) controller.enqueue(normalizedPart);
          },
          flush() {
            if (!sawFinish) normalizer.failOnDisconnect();
          },
        })),
      };
    },
  };
}
