/**
 * @module utils/models/providers/claude-code-prompt
 *
 * A `transformParams`-only middleware that prepares a prompt for the `ai-sdk-provider-claude-code`
 * provider. That provider joins an AI-SDK prompt into the content of a single CLI user turn and
 * never sends system messages as the CLI's system prompt. The middleware does two things:
 *
 * 1. Turns every system message into a user message in place, so the prompt means what the
 *    provider actually sends. Nothing is merged: `system, system, user, system` becomes
 *    `user, user, user, user`, and each message keeps its provider options.
 * 2. Maps VD's cache anchors to Claude Code cache markers. The provider (through the patch in
 *    `patches/`) splits the turn into separate content blocks after each marked message and sends
 *    the marker as the block's `cache_control`.
 *
 * Installed by `buildClaudeCodeModel` (`providers/claude-code.ts`) for every Claude Code model,
 * including requests without function tools. It never touches message text, so it cannot corrupt
 * tool argument schemas.
 */

import { type LanguageModelMiddleware } from 'ai';
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { hasCacheBreakpoint } from '../cache-breakpoint.js';

/**
 * The Claude Code cache marker and how many of them a request may carry. The CLI places two of the
 * API's four markers itself (system prompt and the end of the conversation), so VD gets the other
 * two. The API rejects a longer TTL after a shorter one, so the CLI's markers must use the same
 * TTL as ours. `buildClaudeCodeModel` pins the CLI to this TTL through its environment.
 */
export const claudeCodeCacheMarkers = {
  cacheControl: { type: 'ephemeral', ttl: '1h' },
  max: 2,
} as const;

/**
 * Turn each system message into a user message carrying the same text and provider options,
 * keeping order. A prompt without system messages is returned as-is, same reference; otherwise a
 * new array is returned and the input is never mutated.
 */
export function demoteClaudeCodeSystemMessages(prompt: LanguageModelV4Prompt): LanguageModelV4Prompt {
  if (!prompt.some((message) => message.role === 'system')) return prompt;
  return prompt.map((message) => message.role === 'system'
    ? {
      role: 'user',
      content: [{ type: 'text', text: message.content }],
      ...(message.providerOptions && { providerOptions: message.providerOptions }),
    }
    : message);
}

/**
 * Give the first {@link claudeCodeCacheMarkers}.max anchored user messages a Claude Code cache
 * marker. Only user messages count, since the provider reads markers from user and system
 * messages and system messages are already demoted. Later anchors keep only their `anthropic`
 * option, which the provider ignores. Returns the same reference when nothing is marked.
 */
export function markClaudeCodeCacheAnchors(prompt: LanguageModelV4Prompt): LanguageModelV4Prompt {
  let marked = 0;
  let changed = false;
  const out = prompt.map((message) => {
    if (marked >= claudeCodeCacheMarkers.max || message.role !== 'user' || !hasCacheBreakpoint(message)) return message;
    marked++;
    changed = true;
    return {
      ...message,
      providerOptions: {
        ...message.providerOptions,
        'claude-code': { ...message.providerOptions?.['claude-code'], cacheControl: claudeCodeCacheMarkers.cacheControl },
      },
    };
  });
  return changed ? out : prompt;
}

/**
 * Middleware that applies {@link demoteClaudeCodeSystemMessages} and then
 * {@link markClaudeCodeCacheAnchors} to the outgoing prompt. Only transformParams is implemented;
 * response handling is left to `claudeCodeResponseMiddleware`. Returns the params object untouched
 * when there is nothing to change.
 */
export function claudeCodeSystemMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4' as const,
    transformParams: async ({ params }) => {
      const prompt = params.prompt;
      if (!prompt || prompt.length === 0) return params;
      const prepared = markClaudeCodeCacheAnchors(demoteClaudeCodeSystemMessages(prompt));
      return prepared === prompt ? params : { ...params, prompt: prepared };
    },
  };
}
