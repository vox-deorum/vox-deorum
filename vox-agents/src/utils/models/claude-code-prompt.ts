/**
 * @module utils/models/claude-code-prompt
 *
 * A `transformParams`-only middleware that normalizes the system messages of a prompt for the
 * `ai-sdk-provider-claude-code` provider. That provider flattens an AI-SDK prompt into a single
 * CLI turn and keeps only the last system message it sees: every earlier system message (the
 * agent's main prompt, the game situation, and, critically, the tool-rescue-injected
 * `## Available Actions` schema block) is silently discarded, leaving the model to guess tool
 * argument names.
 *
 * Normalization merges the leading run of consecutive system messages into one system message and
 * demotes every system message after the first user/assistant message into a user message so its
 * content survives inline. The shape `system, system, user, system` becomes
 * `system(1+2), user, user`. A prompt with at most one system message is left untouched, since the
 * provider keeps a lone system message wherever it sits.
 *
 * Wired only for the claude-code provider, inner to the tool-rescue middleware; see the wiring
 * comment in `getModel` (models.ts) for the ordering rationale. It never touches user/assistant
 * message bodies, so it cannot corrupt tool argument schemas.
 */

import { type LanguageModelMiddleware } from 'ai';
import type {
  LanguageModelV3Message,
  LanguageModelV3Prompt,
} from '@ai-sdk/provider';

/**
 * Normalize a prompt's system messages for the claude-code provider (see module docs):
 *  - merge the leading run of consecutive system messages into ONE leading system message;
 *  - demote any later system message (after the first user/assistant message) to a user message.
 *
 * A prompt carrying at most one system message needs no normalization (the provider keeps a lone
 * system message regardless of position) and is returned as-is, same reference. Otherwise a new
 * array is returned and the input is never mutated. Order-preserving for every non-system message.
 */
export function normalizeClaudeCodeSystemMessages(prompt: LanguageModelV3Prompt): LanguageModelV3Prompt {
  // Only prompts with two or more system messages need merging or demotion; a lone system message
  // survives the provider's flattening wherever it sits.
  let systemCount = 0;
  for (const message of prompt) {
    if (message.role === 'system') systemCount++;
  }
  if (systemCount <= 1) return prompt;

  const leading: string[] = [];
  const body: LanguageModelV3Message[] = [];
  let leadingRunEnded = false;

  for (const message of prompt) {
    if (message.role === 'system') {
      if (!leadingRunEnded) {
        // Still in the leading prefix: accumulate for the single merged system message.
        leading.push(message.content);
      } else {
        // A system message after the first user/assistant message: the provider would drop it, so
        // demote it to a user message (untagged text) to keep its content in the flattened turn.
        body.push({ role: 'user', content: [{ type: 'text', text: message.content }] });
      }
      continue;
    }
    // First non-system message ends the leading run; every later system message is demoted.
    leadingRunEnded = true;
    body.push(message);
  }

  const result: LanguageModelV3Prompt = [];
  // Two or more system messages do not guarantee a leading run (they may all trail the first user
  // message), so only emit the merged system message when the prefix is non-empty.
  if (leading.length > 0) {
    result.push({ role: 'system', content: leading.join('\n\n') });
  }
  result.push(...body);
  return result;
}

/**
 * Middleware that applies {@link normalizeClaudeCodeSystemMessages} to the outgoing prompt. Only
 * transformParams is implemented; response handling is left entirely to the other middleware in the
 * chain (tool-rescue). Returns the params object untouched when normalization changes nothing
 * (empty prompt, or at most one system message).
 */
export function claudeCodeSystemMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3' as const,
    transformParams: async ({ params }) => {
      const prompt = params.prompt;
      if (!prompt || prompt.length === 0) return params;
      const normalized = normalizeClaudeCodeSystemMessages(prompt);
      return normalized === prompt ? params : { ...params, prompt: normalized };
    },
  };
}
