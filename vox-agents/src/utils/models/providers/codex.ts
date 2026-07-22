/**
 * Codex model construction and its rc.2 proxy request policy.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { Agent } from 'undici';
import type { ProviderMetadata } from 'ai';
import type { Model } from '../../../types/index.js';
import {
  codexProxyManager,
  ensureCodexProxy,
  getCodexExecutionTimeout,
  getCodexProxyApiBase,
  getCodexProxyConfig,
} from './codex-proxy.js';
import type { CodexProxyConfig } from './codex-proxy.js';
import type { ModelRuntimeIdentity } from './host-tools.js';

/** Long-lived loopback dispatchers shared by Codex models with the same deadline. */
const codexDispatchers = new Map<number, Agent>();

/** Returns a shared dispatcher whose ceilings match the configured outer attempt budget. */
function getCodexDispatcher(config: CodexProxyConfig): Agent {
  const timeout = getCodexExecutionTimeout(config);
  let dispatcher = codexDispatchers.get(timeout);
  if (!dispatcher) {
    dispatcher = new Agent({
      headersTimeout: timeout,
      bodyTimeout: timeout,
      connectTimeout: 30_000,
      keepAliveTimeout: 600_000,
    });
    codexDispatchers.set(timeout, dispatcher);
  }
  return dispatcher;
}

/**
 * Builds a native-tool Codex model backed by the local compatible proxy. The
 * proxy starts lazily from fetch, so constructing unrelated models has no effect.
 */
export function buildCodexModel(config: Model): LanguageModelV3 {
  const middleware = config.options?.toolMiddleware;
  if (middleware === 'prompt' || middleware === 'gemma') {
    throw new Error(`Codex requires native function tools. toolMiddleware '${middleware}' is not supported; use 'rescue' or omit it.`);
  }

  const proxyConfig = getCodexProxyConfig();
  const dispatcher = getCodexDispatcher(proxyConfig);
  return createOpenAICompatible({
    baseURL: getCodexProxyApiBase(proxyConfig.port),
    name: 'codex',
    apiKey: 'local',
    includeUsage: true,
    fetch: async (url, options) => {
      await ensureCodexProxy(options?.signal ?? undefined);
      try {
        return await fetch(url, { ...options, dispatcher } as RequestInit);
      } catch (error) {
        if (error instanceof TypeError) codexProxyManager.invalidateConnection();
        throw error;
      }
    },
  }).chatModel(config.name);
}

/**
 * Builds the narrowly whitelisted Codex extension supported by proxy rc.2.
 * rc.2 cannot enforce host-tool allowlists, so non-empty hostTools fail closed.
 */
export function buildCodexProviderOptions(
  model: Model,
  _runtimeIdentity?: ModelRuntimeIdentity,
): ProviderMetadata {
  const requestedHostTools = model.options?.hostTools;
  if (requestedHostTools && requestedHostTools.length > 0) {
    throw new Error('Codex hostTools require a proxy version that supports validated host-tool allowlists. Leave hostTools empty for codex-openai-proxy@0.1.0-rc.2.');
  }
  const options: {
    x_codex: { sandbox: 'read-only'; web_search: 'disabled' };
    reasoningEffort?: string;
  } = {
    x_codex: { sandbox: 'read-only', web_search: 'disabled' },
  };
  if (model.options?.reasoningEffort !== undefined) options.reasoningEffort = model.options.reasoningEffort;
  return { codex: options };
}
