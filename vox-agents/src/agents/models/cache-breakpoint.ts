/**
 * @module agents/models/cache-breakpoint
 *
 * The Anthropic prompt-cache breakpoint marker shared by every agent prompt, plus the helpers that
 * place it and keep a request under the provider's breakpoint ceiling.
 */

import type { ModelMessage } from "ai";

/**
 * The breakpoint marker itself. Honored by the direct Anthropic provider, OpenRouter (whose
 * provider falls back to the `anthropic` key) and Vertex Anthropic. Claude Code turns the first
 * two into its own markers (`providers/claude-code-prompt.ts`). Other providers ignore it.
 * Spread into a message's `providerOptions` to mark the end of a cacheable prefix. Entries live for
 * five minutes, refreshed on every read, so a prefix survives the steps of one run and back-to-back
 * runs that share it.
 */
export const cacheBreakpoint = { anthropic: { cacheControl: { type: "ephemeral" as const, ttl: "5m" as const } } };

/**
 * The Anthropic prompt cache accepts at most this many cache-control breakpoints per request; a
 * request carrying more is rejected outright. Callers that add a breakpoint check against it, so a
 * new anchor that would push a request over the limit is skipped or logged instead of failing as
 * a provider error at request time.
 */
export const MAX_CACHE_BREAKPOINTS = 4;

/** Whether a message (a model message or a provider prompt message) carries a cache breakpoint. */
export function hasCacheBreakpoint(message: Pick<ModelMessage, "providerOptions">): boolean {
  return message.providerOptions?.anthropic?.cacheControl !== undefined;
}

/** Counts the messages in a request that carry a cache breakpoint. */
export function countCacheBreakpoints(messages: ModelMessage[]): number {
  return messages.filter(hasCacheBreakpoint).length;
}

/**
 * Attach a cache breakpoint to the LAST message of `messages`, in place. The slot is replaced with
 * an annotated copy; the message object itself is never mutated, and any existing
 * `providerOptions` are spread through. No-op on an empty array.
 */
export function markBreakpointOnLast(messages: ModelMessage[]): void {
  const last = messages[messages.length - 1];
  if (!last) return;
  messages[messages.length - 1] = {
    ...last,
    providerOptions: { ...last.providerOptions, ...cacheBreakpoint },
  } as ModelMessage;
}
