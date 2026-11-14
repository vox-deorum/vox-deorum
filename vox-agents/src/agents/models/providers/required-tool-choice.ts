/**
 * Shared middleware for providers whose wire protocol rejects a required tool
 * choice (Anthropic, directly or on Vertex, and the Codex proxy, which only
 * supports automatic or disabled). Converts the choice to auto; the agent loop's
 * closing reminder says the step must call a tool.
 *
 * The system instruction names the caller's completion tools ({@link VoxAgent.completionTools}) as
 * the ones that end the turn, and marks the rest as support: the remaining client function tools
 * plus, when Codex has Web on, its built-in web search. Naming every client tool as a way to
 * "finish" made models satisfy the requirement with a support call and postpone a completion they
 * were ready to make. It is added whatever the tool choice, so it never moves the cached prefix.
 */

import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Middleware,
} from '@ai-sdk/provider';
import { formatToolChoiceList } from '../../tools/tool-names.js';
import { appendSystemInstruction } from './system-prompt.js';

/** Installation options: the calling agent's completion tools, when it declares any. */
export interface RequiredToolChoiceOptions {
  completionTools?: string[];
}

/** Return the declared client function tool names, deduplicated in declaration order. */
export function clientFunctionToolNames(params: LanguageModelV4CallOptions): string[] {
  return [...new Set((params.tools ?? [])
    .filter((tool) => tool.type === 'function')
    .map((tool) => tool.name))];
}

/** Whether the request also declares host tools the provider executes itself (Codex built-ins). */
export function hasProviderTools(params: LanguageModelV4CallOptions): boolean {
  return (params.tools ?? []).some((tool) => tool.type === 'provider');
}

/**
 * The instruction that tells the model which declared tools end the turn and which only support it.
 * It does not depend on the step's tool choice, so a step that drops to auto (all tools removed)
 * keeps the same system text and the cached prefix; whether the step must call a tool is said in
 * the agent loop's closing reminder instead. Every sentence is assembled from what the request
 * declares: the support sentence names only the categories present. Returns undefined when no
 * declared client tool completes the turn.
 *
 * Exported so callers (and tests) compose against this one builder instead of duplicating wording.
 */
export function completionToolsInstruction(
  clientNames: string[],
  completionNames: string[],
  withBuiltInTools: boolean,
): string | undefined {
  const completionList = formatToolChoiceList(completionNames.filter((name) => clientNames.includes(name)));
  if (!completionList) return undefined;

  const supportList = formatToolChoiceList(clientNames.filter((name) => !completionNames.includes(name)));
  const others = [supportList, withBuiltInTools ? 'the built-in tools' : undefined].filter(Boolean).join(' and ');
  const support = others
    ? ` Use other tools, including ${others}, to support your mission.`
    : '';
  return `IMPORTANT: Your goal is to issue terminal tools to end the turn, which include: ${completionList}.${support}`;
}

/**
 * Replace a wire-level required tool choice with auto, and name the caller's completion tools in
 * the system prompt whatever the tool choice, so the prompt text never changes with it. The
 * completion names are intersected with the tools declared on the wire (the run's declared tools,
 * unchanged by mid-run removals), so an agent without a declared completion tool never advertises
 * one. The requirement itself is stated by the agent loop's closing reminder, which every provider
 * gets.
 */
export function requiredToolChoiceMiddleware(options?: RequiredToolChoiceOptions): LanguageModelV4Middleware {
  const completionTools = options?.completionTools ?? [];
  return {
    specificationVersion: 'v4',
    transformParams: async ({ params }) => {
      const toolChoice = params.toolChoice?.type === 'required' ? { type: 'auto' as const } : params.toolChoice;
      const instruction = completionToolsInstruction(
        clientFunctionToolNames(params),
        completionTools,
        hasProviderTools(params),
      );
      if (!instruction && toolChoice === params.toolChoice) return params;
      return {
        ...params,
        toolChoice,
        prompt: instruction ? appendSystemInstruction(params.prompt, instruction) : params.prompt,
      };
    },
  };
}
