/**
 * Codex model construction and its proxy request policy.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { wrapLanguageModel } from 'ai';
import { Agent } from 'undici';
import type { ProviderMetadata } from 'ai';
import type { Model } from '../../../types/index.js';
import {
  codexProxyManager,
  ensureCodexProxy,
  getActiveCodexProxyPort,
  getCodexExecutionTimeout,
  getCodexProxyApiBase,
  getCodexProxyConfig,
} from './codex-proxy.js';
import type { CodexProxyConfig } from './codex-proxy.js';
import { codexActivityMiddleware } from './codex-response.js';
import { requiredToolChoiceMiddleware } from './required-tool-choice.js';
import type { RequiredToolChoiceOptions } from './required-tool-choice.js';
import { resolveHostToolCapabilities } from './host-tools.js';

/** Dispatchers share timeout settings across models, but never reuse connections. */
const codexDispatchers = new Map<number, Agent>();

/** The request target accepted by the fetch implementation the provider installs. */
type ProxyRequestUrl = Parameters<typeof globalThis.fetch>[0];

/** Returns a shared dispatcher whose ceilings match the configured outer attempt budget. */
function getCodexDispatcher(config: CodexProxyConfig): Agent {
  const timeout = getCodexExecutionTimeout(config);
  let dispatcher = codexDispatchers.get(timeout);
  if (!dispatcher) {
    dispatcher = new Agent({
      headersTimeout: timeout,
      bodyTimeout: timeout,
      connectTimeout: 30_000,
      // Local requests use a fresh connection to avoid idle socket reuse races.
      pipelining: 0,
    });
    codexDispatchers.set(timeout, dispatcher);
  }
  return dispatcher;
}

/**
 * Follows the proxy when its startup scan moved it off the configured port. The
 * base URL is fixed when the model is built, which is before the proxy starts.
 */
function resolveActiveProxyUrl(url: ProxyRequestUrl, configuredPort: number): ProxyRequestUrl {
  const activePort = getActiveCodexProxyPort();
  if (activePort === configuredPort) return url;
  if (typeof url !== 'string' && !(url instanceof URL)) return url;
  const rewritten = new URL(url);
  rewritten.port = String(activePort);
  return rewritten;
}

/**
 * Builds a native-tool Codex model backed by the local compatible proxy. The
 * proxy starts lazily from fetch, so constructing unrelated models has no effect.
 */
export function buildCodexModel(config: Model, options?: RequiredToolChoiceOptions): LanguageModelV4 {
  const middleware = config.options?.toolMiddleware;
  if (middleware === 'prompt' || middleware === 'gemma') {
    throw new Error(`Codex requires native function tools. toolMiddleware '${middleware}' is not supported; use 'rescue' or omit it.`);
  }

  const proxyConfig = getCodexProxyConfig();
  const dispatcher = getCodexDispatcher(proxyConfig);
  const model = createOpenAICompatible({
    baseURL: getCodexProxyApiBase(proxyConfig.port),
    name: 'codex',
    apiKey: 'local',
    includeUsage: true,
    fetch: async (url, options) => {
      await ensureCodexProxy(options?.signal ?? undefined);
      try {
        const response = await fetch(resolveActiveProxyUrl(url, proxyConfig.port), { ...options, dispatcher } as unknown as RequestInit);
        if (response.status >= 500) codexProxyManager.invalidateConnection(`HTTP ${response.status}`);
        else codexProxyManager.recordConnectionSuccess();
        return response;
      } catch (error) {
        if (error instanceof TypeError) codexProxyManager.invalidateConnection();
        throw error;
      }
    },
  }).chatModel(config.name);
  // The first middleware is outermost: it adapts a required tool choice before
  // activity normalization, and both run inner to the generic rescue wrapper
  // installed by models.ts. Its instruction names the caller's completion tools,
  // so the host's built-in tools read as support rather than as a way to finish.
  return wrapLanguageModel({
    model,
    middleware: [
      requiredToolChoiceMiddleware({ completionTools: options?.completionTools }),
      codexActivityMiddleware(),
    ],
  });
}

/** The per-request Codex policy extension accepted by the pinned proxy. */
export type CodexRequestExtension = {
  sandbox: 'disabled';
  web_search: 'disabled' | 'live';
};

/**
 * Maps the configured host meta-tools onto the proxy's per-request policy:
 * Web enables live search, and everything else stays off. Codex never touches
 * the local filesystem, so the sandbox is always disabled and no working
 * directory is sent. An optional previous response id is forwarded as the
 * proxy's previous_response_id continuation preference, so it resumes the
 * same thread.
 */
export function buildCodexProviderOptions(
  model: Model,
  previousResponseId?: string,
): ProviderMetadata {
  const capabilities = resolveHostToolCapabilities(model.options?.hostTools);
  const extension: CodexRequestExtension = {
    sandbox: 'disabled',
    web_search: capabilities.web ? 'live' : 'disabled',
  };

  const options: { x_codex: CodexRequestExtension; reasoningEffort?: string; previous_response_id?: string } = { x_codex: extension };
  if (model.options?.reasoningEffort !== undefined) options.reasoningEffort = model.options.reasoningEffort;
  // The adapter spreads unknown keys of this object top-level, so the selector
  // reaches the request body as the proxy's native continuation preference.
  if (previousResponseId !== undefined) options.previous_response_id = previousResponseId;
  return { codex: options };
}
