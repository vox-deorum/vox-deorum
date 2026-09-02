/**
 * Immutable helpers for adding provider middleware instructions to a prompt.
 */

import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';

/**
 * Append an instruction to the leading system message, or create one when the
 * prompt does not contain a system message. The caller's prompt is never
 * mutated, so reusing it for another request cannot accumulate instructions.
 */
export function appendSystemInstruction(
  prompt: LanguageModelV3CallOptions['prompt'],
  instruction: string,
): LanguageModelV3CallOptions['prompt'] {
  const systemIndex = prompt.findIndex((message) => message.role === 'system');
  if (systemIndex < 0) return [{ role: 'system', content: instruction }, ...prompt];

  const systemMessage = prompt[systemIndex];
  // findIndex establishes this role, while the check narrows the union type.
  if (systemMessage.role !== 'system') return prompt;

  const transformed = [...prompt];
  transformed[systemIndex] = {
    ...systemMessage,
    content: `${systemMessage.content}\n\n${instruction}`,
  };
  return transformed;
}
