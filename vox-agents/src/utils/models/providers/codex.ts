/**
 * Codex model construction and its proxy request policy.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV3 } from '@ai-sdk/provider';
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
import { resolveHostToolAccess, seedHostWorkspaceGuide } from './host-tools.js';
import type { ModelRuntimeIdentity } from './host-tools.js';

/** Long-lived loopback dispatchers shared by Codex models with the same deadline. */
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
      keepAliveTimeout: 600_000,
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
export function buildCodexModel(config: Model, options?: RequiredToolChoiceOptions): LanguageModelV3 {
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
        return await fetch(resolveActiveProxyUrl(url, proxyConfig.port), { ...options, dispatcher } as RequestInit);
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
  sandbox: 'disabled' | 'read-only' | 'workspace-write';
  web_search: 'disabled' | 'live';
  cwd?: string;
};

/**
 * Maps resolved host meta-tool access onto the proxy's per-request policy:
 * Write selects a workspace-write sandbox in an isolated working directory
 * under the proxy root (which Codex itself enforces, network stays off), and
 * Web enables live search. File access is disabled unless Read or Write is
 * explicitly granted, and Web alone never creates a working directory.
 */
export function buildCodexProviderOptions(
  model: Model,
  runtimeIdentity?: ModelRuntimeIdentity,
): ProviderMetadata {
  const access = resolveHostToolAccess(model.options?.hostTools, {
    workingDirectoryBase: getCodexProxyConfig().root,
    workingDirId: runtimeIdentity?.workingDirId,
    workingDirectoryTools: ['Read', 'Write'],
  });
  seedHostWorkspaceGuide(access, 'codex');
  const extension: CodexRequestExtension = {
    sandbox: access.write ? 'workspace-write' : access.read ? 'read-only' : 'disabled',
    web_search: access.web ? 'live' : 'disabled',
  };
  // The proxy requires cwd to be its --root or a descendant; the working
  // directory is created under that root, so containment holds by construction.
  if (access.workingDirectory) extension.cwd = access.workingDirectory;

  const options: { x_codex: CodexRequestExtension; reasoningEffort?: string } = { x_codex: extension };
  if (model.options?.reasoningEffort !== undefined) options.reasoningEffort = model.options.reasoningEffort;
  return { codex: options };
}
