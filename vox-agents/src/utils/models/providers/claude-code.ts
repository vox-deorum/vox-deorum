/**
 * Claude Code model construction and host-tool translation.
 */

import os from 'node:os';
import path from 'node:path';
import { wrapLanguageModel } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { createClaudeCode, type ClaudeCodeSettings } from 'ai-sdk-provider-claude-code';
import type { Model } from '../../../types/index.js';
import { claudeCodeResponseMiddleware, guardClaudeCodeQueryUsageLimits } from './claude-code-response.js';
import { resolveHostToolAccess } from './host-tools.js';
import type { HostToolAccess, ModelRuntimeIdentity } from './host-tools.js';

/** Concrete Claude Code tools granted by each host meta-tool. */
export const claudeCodeMetaToolExpansion: Record<'Read' | 'Write' | 'Web', readonly string[]> = {
  Read: ['Read', 'Glob', 'Grep'],
  Write: ['Write', 'Edit'],
  Web: ['WebFetch', 'WebSearch'],
};

/**
 * Expands resolved meta-tool access into the concrete Claude Code tool list.
 * TodoWrite bookkeeping rides along whenever any capability is enabled.
 */
export function expandClaudeCodeTools(access: HostToolAccess): string[] {
  const tools: string[] = [];
  if (access.read) tools.push(...claudeCodeMetaToolExpansion.Read);
  if (access.write) tools.push(...claudeCodeMetaToolExpansion.Write);
  if (access.web) tools.push(...claudeCodeMetaToolExpansion.Web);
  if (tools.length > 0) tools.push('TodoWrite');
  return tools;
}

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
  const hostToolAccess = resolveHostToolAccess(options.hostTools, {
    workingDirectoryBase: path.join(os.tmpdir(), 'vox-claude-code'),
    workingDirId: runtimeIdentity?.workingDirId,
  });
  const hostTools = expandClaudeCodeTools(hostToolAccess);

  if (hostTools.length === 0) {
    settings.tools = [];
  } else {
    // Availability is bounded by `tools`; `allowedTools` and dontAsk enforce
    // permissions. Do not set disallowedTools because the provider warns when
    // it is combined with an allowlist.
    settings.cwd = hostToolAccess.workingDirectory;
    settings.tools = hostTools;
    settings.permissionMode = 'dontAsk';
    settings.allowedTools = hostTools.map((tool) =>
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
