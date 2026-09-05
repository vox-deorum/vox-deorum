/**
 * Normalizes Codex built-in activity into AI SDK provider-executed dynamic
 * tool parts.
 */

import type {
  JSONValue,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3Middleware,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
} from '@ai-sdk/provider';
import { createLogger } from '../../logger.js';
import { preserveModelError } from '../preserved-model-error.js';
import { classifyProviderActivityStatus } from './activity-status.js';
import { clientFunctionToolNames } from './required-tool-choice.js';

/** Provider-boundary logger for Codex response diagnostics. */
const codexResponseLogger = createLogger('CodexResponse');

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

/** A transient app-server transport failure that the outer model loop may retry. */
export class CodexProviderTransportError extends Error {
  /** Allow the shared retry layer to start a fresh Codex attempt. */
  readonly isRetryable = true;

  /** Preserve the adapter error while exposing a stable retry classification. */
  constructor(cause: unknown) {
    super('Codex app-server transport channel closed.', { cause });
    this.name = 'CodexProviderTransportError';
  }
}

/** A retryable ChatGPT usage limit reported by the managed Codex proxy. */
export class CodexUsageLimitError extends Error {
  /** Allow the shared retry layer to wait until the proxy-provided reset time. */
  readonly isRetryable = true;

  /** Absolute epoch timestamp at which a fresh Codex attempt may start. */
  readonly retryAt: number;

  /** Create a quota error targeting the provided absolute retry timestamp. */
  constructor(retryAt: number, cause?: unknown) {
    super('Codex ChatGPT usage limit reached.', cause === undefined ? undefined : { cause });
    this.name = 'CodexUsageLimitError';
    this.retryAt = retryAt;
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

/** Loose representation of the proxy's activity result shape. */
type RawToolResult = {
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
  result?: unknown;
};

/** Keeps each transformed stream request's caller raw-chunk preference private. */
const rawChunkPreferences = new WeakMap<LanguageModelV3CallOptions, boolean>();

/**
 * Deterministic typed continuation errors that cannot succeed on an outer model
 * retry. Unavailable continuations are absent because the proxy admits them
 * synchronously and executes the supplied transcript on a fresh thread instead
 * of rejecting the request.
 */
const terminalContinuationCodes = new Set([
  'duplicate_tool_call_id',
  'thread_not_resumable',
  'tool_results_required',
  'tool_results_without_pending_call',
]);

/** Quota states that cannot become available through waiting and retrying. */
const terminalQuotaCodes = new Set([
  'insufficient_credits',
  'workspace_usage_limit_exceeded',
]);

const quotaRetryFallbackMs = 5 * 60 * 1000;
const quotaRetryGraceMs = 15 * 1000;
const maximumQuotaRetryDelayMs = 8 * 24 * 60 * 60 * 1000;

/** Return a record only for object values that can safely be inspected. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Read the proxy's verbatim instruction-source paths from one response envelope. */
function extractInstructionSources(value: unknown): string[] | undefined {
  const instructionSources = asRecord(asRecord(value)?.x_codex)?.instructionSources;
  if (!Array.isArray(instructionSources) || !instructionSources.every((source) => typeof source === 'string')) {
    return undefined;
  }
  return [...instructionSources];
}

/** Attach Codex instruction sources to the provider metadata carried by the AI SDK. */
function withInstructionSources(
  providerMetadata: SharedV3ProviderMetadata | undefined,
  instructionSources: string[] | undefined,
): SharedV3ProviderMetadata | undefined {
  if (instructionSources === undefined) return providerMetadata;
  return {
    ...(providerMetadata ?? {}),
    codex: {
      ...(providerMetadata?.codex ?? {}),
      instructionSources,
    },
  };
}

/** Warn when the compatible response omitted its optional reasoning-token statistic. */
function logMissingReasoningTokenStatistics(usage: LanguageModelV3Usage): void {
  const rawUsage = asRecord(usage.raw);
  const completionDetails = asRecord(rawUsage?.completion_tokens_details);
  if (typeof completionDetails?.reasoning_tokens !== 'number') {
    codexResponseLogger.warn(
      'Codex response omitted completion_tokens_details.reasoning_tokens; reasoning token usage will be estimated.',
    );
  }
}

/** Return a non-retryable error with a consistent proxy-protocol prefix. */
function protocolError(reason: string): CodexProviderProtocolError {
  return new CodexProviderProtocolError(`Codex proxy activity protocol error: ${reason}.`);
}

/** Find the app-server's transient channel-closure signature through adapter error wrappers. */
function isTransportChannelClosed(error: unknown, seen = new Set<object>()): boolean {
  if (typeof error === 'string') return /transport channel closed/i.test(error);
  if (error === null || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  const record = error as Record<string, unknown>;
  return ['message', 'responseBody', 'data', 'error', 'cause']
    .some((key) => isTransportChannelClosed(record[key], seen));
}

/** Parsed stable proxy error fields shared by HTTP failures and raw SSE envelopes. */
type ProxyErrorDetails = {
  code?: string;
  resetAtSeconds?: number;
};

/** Return the proxy response body, retaining extensions that the adapter's data omits. */
function proxyResponseBody(error: unknown): Record<string, unknown> | undefined {
  const record = asRecord(error);
  if (typeof record?.responseBody !== 'string') return undefined;
  try {
    return asRecord(asRecord(JSON.parse(record.responseBody) as unknown)?.error);
  } catch {
    return undefined;
  }
}

/** Extract the proxy's stable error fields from an AI SDK failure or raw envelope. */
function proxyErrorDetails(error: unknown): ProxyErrorDetails {
  const record = asRecord(error);
  // A raw SSE envelope carries only a top-level error, while an adapter HTTP failure
  // carries the same body twice: parsed data whose schema drops extensions such as
  // x_codex, and the original response text. Extensions must prefer the reparsed body.
  const adapterError = asRecord(record?.error) ?? asRecord(asRecord(record?.data)?.error);
  const bodyError = proxyResponseBody(error);
  const code = (adapterError ?? bodyError)?.code;
  const resetAt = asRecord((bodyError ?? adapterError)?.x_codex)?.reset_at;
  return {
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof resetAt === 'number' && Number.isFinite(resetAt) ? { resetAtSeconds: resetAt } : {}),
  };
}

/** Return the HTTP status preserved by an AI SDK API-call error. */
function proxyStatusCode(error: unknown): number | undefined {
  const statusCode = asRecord(error)?.statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

/** Return one response header value without relying on the adapter's header representation. */
function proxyResponseHeader(error: unknown, name: string): string | undefined {
  const headers = asRecord(asRecord(error)?.responseHeaders);
  if (headers === undefined) return undefined;
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected && typeof value === 'string') return value;
  }
  return undefined;
}

/** Resolve a valid future proxy quota reset, retaining a short post-reset grace period. */
function validQuotaRetryAt(resetAtMs: number | undefined, now: number): number | undefined {
  if (resetAtMs === undefined || resetAtMs <= now || resetAtMs > now + maximumQuotaRetryDelayMs) {
    return undefined;
  }
  return resetAtMs + quotaRetryGraceMs;
}

/** Parse the proxy's decimal Retry-After fallback into an absolute timestamp. */
function retryAfterAt(error: unknown, now: number): number | undefined {
  const retryAfter = proxyResponseHeader(error, 'retry-after');
  if (retryAfter === undefined || !/^\d+(?:\.\d+)?$/.test(retryAfter.trim())) return undefined;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) ? now + seconds * 1000 : undefined;
}

/** Build a typed retryable error for a proxy usage-limit response. */
function usageLimitError(error: unknown, details: ProxyErrorDetails): CodexUsageLimitError {
  const now = Date.now();
  const retryAt = validQuotaRetryAt(details.resetAtSeconds === undefined ? undefined : details.resetAtSeconds * 1000, now)
    ?? validQuotaRetryAt(retryAfterAt(error, now), now)
    ?? now + quotaRetryFallbackMs;
  return new CodexUsageLimitError(retryAt, error);
}

/** Mark known terminal proxy quota states so broad provider retry handling cannot replay them. */
function markTerminalQuotaError(error: unknown): void {
  if (asRecord(error) !== undefined) (error as { isRetryable?: boolean }).isRetryable = false;
}

/** Mark deterministic proxy continuation failures as terminal for Vox Deorum's retry layer. */
function classifyContinuationFailure(error: unknown, code: string | undefined): never {
  if (code !== undefined && terminalContinuationCodes.has(code) && asRecord(error) !== undefined) {
    (error as { isRetryable?: boolean }).isRetryable = false;
  }
  throw error;
}

/** Classify quota and continuation failures thrown before any response chunk is available. */
function classifyProviderFailure(error: unknown): never {
  const details = proxyErrorDetails(error);
  if (proxyStatusCode(error) === 429 && details.code === 'usage_limit_exceeded') {
    throw usageLimitError(error, details);
  }
  if (details.code !== undefined && terminalQuotaCodes.has(details.code)) {
    markTerminalQuotaError(error);
  }
  return classifyContinuationFailure(error, details.code);
}

/** Classify a raw proxy SSE error before the compatible adapter discards extensions. */
function classifyRawProxyFailure(raw: unknown): Error | undefined {
  const details = proxyErrorDetails(raw);
  if (details.code === 'usage_limit_exceeded') return usageLimitError(raw, details);
  if (details.code !== undefined && terminalQuotaCodes.has(details.code)) {
    const message = asRecord(asRecord(raw)?.error)?.message;
    const error = new Error(typeof message === 'string'
      ? message
      : `Codex proxy rejected the request with ${details.code}.`, { cause: raw });
    markTerminalQuotaError(error);
    return error;
  }
  return undefined;
}

/** Execute one adapter operation while preserving and refining its retry classification. */
async function withProviderFailureClassification<T>(operation: () => PromiseLike<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return classifyProviderFailure(error);
  }
}

/** Return whether a value is a JSON value accepted by an AI SDK tool result. */
function isJsonValue(value: unknown): value is JSONValue {
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
  return new Set(clientFunctionToolNames(params));
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

  /** Normalize raw activity results after verifying their unique call correlation. */
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
      const status = classifyProviderActivityStatus(result);
      if (!status) throw protocolError(`tool result has unsupported status '${result.status}'`);
      const preliminary = status === 'preliminary';
      activity.preliminary ||= preliminary;
      activity.finished = !preliminary;
      parts.push({
        type: 'tool-result',
        toolCallId: id,
        toolName: activity.toolName,
        result,
        ...(preliminary ? { preliminary: true } : {}),
        ...(status === 'failed' ? { isError: true } : {}),
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
        isError: true,
        dynamic: true,
      });
    }
    return parts;
  }

  /** Classify a stream failure, rejecting ambiguous disconnects after activity has started. */
  failOnDisconnect(error?: unknown): void {
    if (isTransportChannelClosed(error)) throw new CodexProviderTransportError(error);
    if (this.pendingCandidates.size > 0 || this.calls.size > 0) {
      throw protocolError('stream disconnected during built-in activity');
    }
  }
}

/** Normalize Codex raw activity while preserving compatible adapter text and reasoning parsing. */
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
      const response = await withProviderFailureClassification(doGenerate);
      logMissingReasoningTokenStatistics(response.usage);
      const normalizer = new ActivityNormalizer(params);
      const payload = rawChoicePayload(response.response?.body);
      const instructionSources = extractInstructionSources(response.response?.body);
      const activity = [
        ...normalizer.ingestCalls(payload?.tool_calls),
        ...normalizer.ingestResults(payload?.tool_results),
        ...normalizer.finishRaw(response.finishReason.raw),
        ...normalizer.finishNormally(),
      ];
      const content = response.content.filter((part) => normalizer.keepGeneratedContent(part));
      return {
        ...response,
        content: [...content, ...activity as LanguageModelV3Content[]],
        providerMetadata: withInstructionSources(response.providerMetadata, instructionSources),
      };
    },
    wrapStream: async ({ doStream, params }) => {
      const response = await withProviderFailureClassification(doStream);
      const normalizer = new ActivityNormalizer(params);
      const requestedRawChunks = rawChunkPreferences.get(params) ?? false;
      let sawFinish = false;
      let sawRawFinish = false;
      let inspectedUsage = false;
      let rawProxyFailure: Error | undefined;
      let inspectedFirstRawChunk = false;
      let instructionSources: string[] | undefined;
      return {
        ...response,
        stream: response.stream.pipeThrough(new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
          transform(part, controller) {
            if (part.type === 'raw') {
              if (requestedRawChunks) controller.enqueue(part);
              if (rawProxyFailure !== undefined) return;
              if (!inspectedFirstRawChunk) {
                inspectedFirstRawChunk = true;
                instructionSources = extractInstructionSources(part.rawValue);
              }
              rawProxyFailure = classifyRawProxyFailure(part.rawValue);
              if (rawProxyFailure !== undefined) return;
              const payload = rawChoicePayload(part.rawValue);
              const finishReason = rawFinishReason(part.rawValue);
              if (finishReason !== undefined) sawRawFinish = true;
              for (const activity of normalizer.ingestCalls(payload?.tool_calls)) controller.enqueue(activity);
              for (const activity of normalizer.ingestResults(payload?.tool_results)) controller.enqueue(activity);
              for (const clientPart of normalizer.finishRaw(finishReason)) controller.enqueue(clientPart);
              return;
            }
            if (rawProxyFailure !== undefined) {
              if (part.type === 'error') {
                preserveModelError(params, rawProxyFailure);
                controller.error(rawProxyFailure);
              }
              return;
            }
            if (part.type === 'error') normalizer.failOnDisconnect(part.error);
            if (part.type === 'finish') {
              if (!sawRawFinish) normalizer.failOnDisconnect();
              if (!inspectedUsage) {
                logMissingReasoningTokenStatistics(part.usage);
                inspectedUsage = true;
              }
              for (const activity of normalizer.finishNormally()) controller.enqueue(activity);
              sawFinish = true;
              const providerMetadata = withInstructionSources(part.providerMetadata, instructionSources);
              controller.enqueue(providerMetadata === part.providerMetadata
                ? part
                : { ...part, providerMetadata });
              return;
            }
            for (const normalizedPart of normalizer.handleAdapterPart(part)) controller.enqueue(normalizedPart);
          },
          flush(controller) {
            if (rawProxyFailure !== undefined) {
              preserveModelError(params, rawProxyFailure);
              controller.error(rawProxyFailure);
              return;
            }
            if (!sawFinish) normalizer.failOnDisconnect();
          },
        })),
      };
    },
  };
}
