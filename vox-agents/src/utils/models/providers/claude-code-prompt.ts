/**
 * @module utils/models/providers/claude-code-prompt
 *
 * A `transformParams`-only middleware that turns every system message of a prompt into a user
 * message, in place, for the `ai-sdk-provider-claude-code` provider. That provider flattens an
 * AI-SDK prompt into the text of a single CLI user turn and never sends system messages as the
 * CLI's system prompt, so stating them as user messages up front makes the prompt mean what the
 * provider actually sends. Nothing is merged: each system message keeps its own position, so the
 * shape `system, system, user, system` becomes `user, user, user, user`.
 *
 * Installed by `buildClaudeCodeModel` (`providers/claude-code.ts`) for every Claude Code model,
 * including requests without function tools. It runs inside the provider's own middleware stack,
 * and there is no tool-rescue schema or prompt for it to demote. It never touches user/assistant
 * message bodies, so it cannot corrupt tool argument schemas.
 */

import { type LanguageModelMiddleware } from 'ai';
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';

/**
 * Turn each system message into a user message carrying the same text, keeping order. A prompt
 * without system messages is returned as-is, same reference; otherwise a new array is returned and
 * the input is never mutated.
 */
export function demoteClaudeCodeSystemMessages(prompt: LanguageModelV4Prompt): LanguageModelV4Prompt {
  if (!prompt.some((message) => message.role === 'system')) return prompt;
  return prompt.map((message) => message.role === 'system'
    ? { role: 'user', content: [{ type: 'text', text: message.content }] }
    : message);
}

/**
 * Middleware that applies {@link demoteClaudeCodeSystemMessages} to the outgoing prompt. Only
 * transformParams is implemented; response handling is left to `claudeCodeResponseMiddleware`.
 * Returns the params object untouched when there is nothing to demote.
 */
export function claudeCodeSystemMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4' as const,
    transformParams: async ({ params }) => {
      const prompt = params.prompt;
      if (!prompt || prompt.length === 0) return params;
      const demoted = demoteClaudeCodeSystemMessages(prompt);
      return demoted === prompt ? params : { ...params, prompt: demoted };
    },
  };
}
