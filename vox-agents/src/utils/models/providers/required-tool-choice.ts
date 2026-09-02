/**
 * Shared middleware for providers whose wire protocol rejects a required tool
 * choice (Anthropic — directly or on Vertex — and the Codex proxy, which only
 * supports automatic or disabled). Converts the choice to auto while restating
 * the requirement as a system-prompt instruction.
 *
 * The restatement names the caller's completion tools ({@link VoxAgent.completionTools}) as the ones
 * that end the turn, and marks the rest as support: the remaining client function tools plus, in
 * Codex's host-tools mode, the built-in tools. Naming every client tool as a way to "finish" made
 * models satisfy the requirement with a support call and postpone a completion they were ready to
 * make. Without a known completion tool the instruction claims no completion at all.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Middleware,
} from '@ai-sdk/provider';
import { formatToolChoiceList } from '../../tools/tool-names.js';
import { appendSystemInstruction } from './system-prompt.js';

/** Installation options: the calling agent's completion tools, when it declares any. */
export interface RequiredToolChoiceOptions {
  completionTools?: string[];
}

/** Return the declared client function tool names, deduplicated in declaration order. */
export function clientFunctionToolNames(params: LanguageModelV3CallOptions): string[] {
  return [...new Set((params.tools ?? [])
    .filter((tool) => tool.type === 'function')
    .map((tool) => tool.name))];
}

/** Whether the request also declares host tools the provider executes itself (Codex built-ins). */
export function hasProviderTools(params: LanguageModelV3CallOptions): boolean {
  return (params.tools ?? []).some((tool) => tool.type === 'provider');
}

/**
 * The instruction that preserves the dropped requirement. Every sentence is assembled from what the
 * step actually declares, so it never claims something untrue: the support sentence names only the
 * categories present, and a step with no declared completion tool gets the requirement without any
 * "this finishes your turn" framing. Returns undefined when there is no client tool to require.
 *
 * Exported so callers (and tests) compose against this one builder instead of duplicating wording.
 */
export function requiredToolChoiceInstruction(
  clientNames: string[],
  completionNames: string[],
  withBuiltInTools: boolean,
): string | undefined {
  const clientList = formatToolChoiceList(clientNames);
  if (!clientList) return undefined;

  // "one or more", never "a tool call": agent prompts encourage batching several calls in one reply,
  // and this restatement must not read as a cap. One step is one reply, so it is addressed as such.
  const opening = 'IMPORTANT: You must issue tool calls to collect information or make actions, as many as you need. Plain text response goes nowhere.';

  const completionList = formatToolChoiceList(completionNames);
  if (!completionList) {
    // Scoping the requirement to the client tools already excludes any built-ins, so no extra clause.
    return `${opening} Those tools include: ${clientList}.`;
  }

  const supportList = formatToolChoiceList(clientNames.filter((name) => !completionNames.includes(name)));
  const others = [supportList, withBuiltInTools ? 'the built-in tools' : undefined].filter(Boolean).join(' and ');
  const support = others
    ? ` Use other tools, including ${others}, to support your mission.`
    : '';
  return `${opening} Your goal is to issue terminal tools to end the turn, which include: ${completionList}.${support}`;
}

/**
 * Replace a wire-level required tool choice with auto and preserve the
 * requirement in the prompt. The completion names are intersected with the tools
 * actually declared on the wire, which already accounts for the step's active
 * tools, so a step that does not offer a completion tool never advertises one.
 * vox-context only requests required when client function tools are active, so an
 * empty name list cannot occur in production; it degrades to plain auto with no
 * instruction.
 */
export function requiredToolChoiceMiddleware(options?: RequiredToolChoiceOptions): LanguageModelV3Middleware {
  const completionTools = new Set(options?.completionTools ?? []);
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      if (params.toolChoice?.type !== 'required') return params;
      const transformed = { ...params, toolChoice: { type: 'auto' as const } };
      const names = clientFunctionToolNames(params);
      const instruction = requiredToolChoiceInstruction(
        names,
        names.filter((name) => completionTools.has(name)),
        hasProviderTools(params),
      );
      if (!instruction) return transformed;
      return {
        ...transformed,
        prompt: appendSystemInstruction(params.prompt, instruction),
      };
    },
  };
}
