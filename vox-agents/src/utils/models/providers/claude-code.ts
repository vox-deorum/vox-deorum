/**
 * Claude Code model construction and host-tool translation.
 */

import { wrapLanguageModel } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { createClaudeCode, type ClaudeCodeSettings } from 'ai-sdk-provider-claude-code';
import type { Model } from '../../../types/index.js';
import { claudeCodeResponseMiddleware, guardClaudeCodeQueryUsageLimits } from './claude-code-response.js';
import { resolveHostToolPolicy } from './host-tools.js';
import type { ModelRuntimeIdentity } from './host-tools.js';

/** Vetted Claude Code tools exposed by the shared `everything` sentinel. */
export const claudeCodeSafeTools = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Write', 'Edit', 'TodoWrite'];
/** Claude Code tools that must remain unavailable even in an explicit allowlist. */
export const claudeCodeBlockedTools = ['Bash'];

/** The constructed Claude Code model and its prompt-mode rebound configuration. */
export interface ClaudeCodeModelBuildResult {
  model: LanguageModelV3;
  config: Model;
}

/**
 * Build a Claude Code model with explicit host-tool permissions and forced
 * prompt-mode game tools, because the provider has no native AI SDK tool calls.
 */
export function buildClaudeCodeModel(
  modelConfig: Model,
  runtimeIdentity?: ModelRuntimeIdentity,
): ClaudeCodeModelBuildResult {
  const config: Model = {
    ...modelConfig,
    options: { ...modelConfig.options, toolMiddleware: 'prompt' },
  };
  const options = config.options ?? {};
  if (Object.hasOwn(options, 'claudeCodeTools')) {
    throw new Error('The `claudeCodeTools` option was renamed to `hostTools`. Update this model configuration.');
  }

  const settings: ClaudeCodeSettings = {
    settingSources: [],
    onQueryCreated: guardClaudeCodeQueryUsageLimits,
  };
  const hostToolPolicy = resolveHostToolPolicy(options.hostTools, {
    everythingExpansion: claudeCodeSafeTools,
    blockedTools: claudeCodeBlockedTools,
    workingDirectoryNamespace: 'vox-claude-code',
    workingDirId: runtimeIdentity?.workingDirId,
  });

  if (hostToolPolicy.allowedTools.length === 0) {
    settings.tools = [];
  } else {
    // Availability is bounded by `tools`; `allowedTools` and dontAsk enforce
    // permissions. Do not set disallowedTools because the provider warns when
    // it is combined with an allowlist.
    settings.cwd = hostToolPolicy.workingDirectory;
    settings.tools = hostToolPolicy.allowedTools;
    settings.permissionMode = 'dontAsk';
    settings.allowedTools = hostToolPolicy.allowedTools.map((tool) =>
      tool === 'Write' || tool === 'Edit' ? `${tool}(./**)` : tool);
  }

  if (options.reasoningEffort === 'minimal') {
    settings.thinking = { type: 'disabled' };
  } else if (options.reasoningEffort) {
    settings.effort = options.reasoningEffort;
    settings.thinking = { type: 'adaptive', display: 'summarized' };
  }

  const model = wrapLanguageModel({
    model: createClaudeCode()(config.name, settings),
    middleware: claudeCodeResponseMiddleware(),
  });
  return { model, config };
}
