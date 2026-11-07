/**
 * Claude Code model construction and host-tool translation.
 *
 * Requests with function tools stream through a {@link ClaudeCodeSession}, which serves the tools
 * to the CLI natively through an in-process MCP server. Requests without them (evaluations with a
 * JSON responseFormat, plain chat) go straight to the provider.
 */

import { wrapLanguageModel } from 'ai';
import type { LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { createClaudeCode, type ClaudeCodeSettings } from 'ai-sdk-provider-claude-code';
import type { Model } from '../../../types/index.js';
import {
  claudeCodeResponseMiddleware,
  currentUsageLimitErrorReceiver,
  guardClaudeCodeQueryUsageLimits,
  hideClaudeCodeStructuredOutputResults,
} from './claude-code-response.js';
import { claudeCodeCacheMarkers, claudeCodeSystemMiddleware } from './claude-code-prompt.js';
import { ClaudeCodeSession, type ClaudeCodeSessionPatch } from './claude-code-session.js';
import { requiredToolChoiceMiddleware } from './required-tool-choice.js';
import { resolveHostToolCapabilities } from './host-tools.js';
import type { HostMetaTool, HostToolCapabilities } from './host-tools.js';

/** Concrete Claude Code tools granted by each host meta-tool. */
export const claudeCodeMetaToolExpansion: Record<HostMetaTool, readonly string[]> = {
  Web: ['WebFetch', 'WebSearch'],
};

/**
 * Expands resolved host capabilities into the concrete Claude Code tool list.
 * TodoWrite bookkeeping rides along whenever any capability is enabled.
 */
export function expandClaudeCodeTools(access: HostToolCapabilities): string[] {
  const tools: string[] = [];
  if (access.web) tools.push(...claudeCodeMetaToolExpansion.Web);
  if (tools.length > 0) tools.push('TodoWrite');
  return tools;
}

/** Options for building a Claude Code model. */
export interface ClaudeCodeModelOptions {
  /** The calling agent's completion tools, named by the required-tool-choice guidance. */
  completionTools?: string[];
  /** The run's live session. Without one, each tool request uses a session of its own. */
  session?: ClaudeCodeSession;
}

/** Build the base provider settings and the host tool list from a model configuration. */
function buildBaseSettings(options: NonNullable<Model['options']>): { settings: ClaudeCodeSettings; hostTools: string[] } {
  const settings: ClaudeCodeSettings = {
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {},
    onQueryCreated: (query) => {
      hideClaudeCodeStructuredOutputResults(query);
      guardClaudeCodeQueryUsageLimits(query);
    },
    // The provider forwards every ANTHROPIC_* variable to the Claude Code CLI,
    // which then bills the API key instead of the subscription login. Unset the
    // key so the CLI falls back to its own credentials; Node drops undefined
    // entries from a child's environment.
    // The CLI picks its own cache lifetime (one hour on a subscription within its limits, five
    // minutes otherwise), and the API rejects VD's markers when they are longer than the CLI's.
    // Pin the CLI to the lifetime VD's markers use.
    env: { ANTHROPIC_API_KEY: undefined, CLAUDE_CODE_PROMPT_CACHE_TTL: claudeCodeCacheMarkers.cacheControl.ttl },
  };
  const hostTools = expandClaudeCodeTools(resolveHostToolCapabilities(options.hostTools));

  if (hostTools.length === 0) {
    settings.tools = [];
  } else {
    // Availability is bounded by `tools`; `allowedTools` and dontAsk enforce
    // permissions. Do not set disallowedTools because the provider warns when
    // it is combined with an allowlist.
    settings.tools = hostTools;
    settings.permissionMode = 'dontAsk';
    settings.allowedTools = hostTools;
  }

  if (options.reasoningEffort === 'minimal') {
    settings.thinking = { type: 'disabled' };
  } else if (options.reasoningEffort) {
    settings.effort = options.reasoningEffort;
    settings.thinking = { type: 'adaptive', display: 'summarized' };
  }
  return { settings, hostTools };
}

/**
 * Merge a session patch into the base settings. The CLI's own tools stay limited to the host
 * tools, the session's MCP tools are allowed without prompting, and both query guards keep
 * running alongside the session's query capture.
 */
export function mergeSessionPatch(
  base: ClaudeCodeSettings,
  hostTools: readonly string[],
  patch: ClaudeCodeSessionPatch,
): ClaudeCodeSettings {
  return {
    ...base,
    env: { ...base.env, ...patch.env },
    mcpServers: patch.mcpServers,
    tools: [...hostTools],
    allowedTools: [...hostTools, ...patch.mcpToolNames],
    permissionMode: 'dontAsk',
    permissionPrompts: 'none',
    persistSession: patch.persistSession,
    onQueryCreated: (query) => {
      hideClaudeCodeStructuredOutputResults(query);
      guardClaudeCodeQueryUsageLimits(query, patch.preserveUsageLimitError);
      patch.onQuery(query);
    },
  };
}

/** Return whether a request lets the model call client function tools. */
function hasFunctionTools(params: LanguageModelV4CallOptions): boolean {
  return params.toolChoice?.type !== 'none' && (params.tools ?? []).some((tool) => tool.type === 'function');
}

/** Drop the tools from a request that must not call them, so the provider answers in text. */
function withoutTools(params: LanguageModelV4CallOptions): LanguageModelV4CallOptions {
  return params.toolChoice?.type === 'none' ? { ...params, tools: undefined, toolChoice: undefined } : params;
}

/**
 * Build a Claude Code model with explicit host-tool permissions. Game tools and bash reach the
 * CLI as native tools through the session's MCP server, so prompt-mode tool middleware does not
 * apply.
 */
export function buildClaudeCodeModel(modelConfig: Model, buildOptions: ClaudeCodeModelOptions = {}): LanguageModelV4 {
  const options = modelConfig.options ?? {};
  if (Object.hasOwn(options, 'claudeCodeTools')) {
    throw new Error('The `claudeCodeTools` option was renamed to `hostTools`. Update this model configuration.');
  }
  if (options.toolMiddleware === 'prompt' || options.toolMiddleware === 'gemma') {
    throw new Error(`Claude Code calls tools natively and does not support toolMiddleware '${options.toolMiddleware}'.`);
  }

  const { settings, hostTools } = buildBaseSettings(options);
  const provider = createClaudeCode();
  const direct = provider(modelConfig.name, settings);
  const key = JSON.stringify(modelConfig);

  const model: LanguageModelV4 = {
    specificationVersion: 'v4',
    provider: direct.provider,
    modelId: direct.modelId,
    supportedUrls: direct.supportedUrls,
    doGenerate: async (params) => {
      if (hasFunctionTools(params)) {
        throw new Error('Claude Code tool requests must stream.');
      }
      return direct.doGenerate(withoutTools(params));
    },
    doStream: async (params) => {
      if (!hasFunctionTools(params)) return direct.doStream(withoutTools(params));
      const session = buildOptions.session ?? new ClaudeCodeSession();
      const result = await session.stream(params, {
        key,
        open: (patch) => provider(modelConfig.name, mergeSessionPatch(settings, hostTools, patch)),
        preserveUsageLimitError: currentUsageLimitErrorReceiver(),
        hostTools,
      });
      if (buildOptions.session) return result;
      // A session made for this request alone closes when its stream ends.
      return {
        ...result,
        stream: result.stream.pipeThrough(new TransformStream({
          flush: () => session.close(),
        })),
      };
    },
  };

  return wrapLanguageModel({
    model,
    middleware: [
      // Anthropic models reject a wire-level required tool choice; the closing reminder states it.
      requiredToolChoiceMiddleware({ completionTools: buildOptions.completionTools }),
      // The provider sends the whole prompt as one CLI user turn, so system text is stated as user text.
      claudeCodeSystemMiddleware(),
      claudeCodeResponseMiddleware(),
    ],
  });
}
