/**
 * Shared middleware for providers whose wire protocol rejects a required tool
 * choice (Anthropic — directly or on Vertex — and the Codex proxy, which only
 * supports automatic or disabled). Converts the choice to auto while restating
 * the requirement as a system-prompt instruction naming the client function
 * tools that satisfy it.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Middleware,
} from '@ai-sdk/provider';

/** Single provider-independent wording for the preserved requirement. */
const requiredInstruction = (renderedNames: string): string =>
  `IMPORTANT: This step has a final-output requirement: finish by calling at least one of these client-provided tools: ${renderedNames}. You can still call other tools if possible and as needed.s`;

/** Return the declared client function tool names, deduplicated in declaration order. */
export function clientFunctionToolNames(params: LanguageModelV3CallOptions): string[] {
  return [...new Set((params.tools ?? [])
    .filter((tool) => tool.type === 'function')
    .map((tool) => tool.name))];
}

/** Append a provider-specific instruction to the existing system prompt, or create one when absent. */
function appendSystemInstruction(
  prompt: LanguageModelV3CallOptions['prompt'],
  instruction: string,
): LanguageModelV3CallOptions['prompt'] {
  const systemIndex = prompt.findIndex((message) => message.role === 'system');
  if (systemIndex < 0) return [{ role: 'system', content: instruction }, ...prompt];
  const systemMessage = prompt[systemIndex];
  // findIndex already established the role; this re-check only narrows the union type.
  if (systemMessage.role !== 'system') return prompt;
  const transformed = [...prompt];
  transformed[systemIndex] = {
    ...systemMessage,
    content: `${systemMessage.content}\n\n${instruction}`,
  };
  return transformed;
}

/**
 * Replace a wire-level required tool choice with auto and preserve the
 * requirement in the prompt. vox-context only requests required when client
 * function tools are active, so an empty name list cannot occur in production;
 * it degrades to plain auto with no instruction.
 */
export function requiredToolChoiceMiddleware(): LanguageModelV3Middleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      if (params.toolChoice?.type !== 'required') return params;
      const transformed = { ...params, toolChoice: { type: 'auto' as const } };
      const names = clientFunctionToolNames(params);
      if (names.length === 0) return transformed;
      const renderedNames = names.map((name) => `\`${name}\``).join(', ');
      return {
        ...transformed,
        prompt: appendSystemInstruction(params.prompt, requiredInstruction(renderedNames)),
      };
    },
  };
}
