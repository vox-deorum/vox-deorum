/**
 * @module utils/models/tool-rescue/transform-params
 *
 * The inbound half of the rescue: teach the model to write tool calls as JSON text, then take its
 * native tools away so it has to.
 *
 * Everything the outbound halves later parse is decided here — the contour the model is shown, the
 * key names in it, and (for a constrained-decoding provider) the grammar its decoder is pinned to.
 */

import type { LanguageModelV4CallOptions, LanguageModelV4Prompt } from '@ai-sdk/provider';
import type { ToolRescueOptions } from './types.js';
import {
  createToolPrompts,
  convertPromptToolMessagesToText,
  reframeToolWording,
  buildToolCallArraySchema,
} from './prompt.js';

/** Rewrite one call's params into prompt-mode form. Returns them untouched when it does not apply. */
export function transformRescueParams(
  params: LanguageModelV4CallOptions,
  options?: ToolRescueOptions
): LanguageModelV4CallOptions {
  // Skip if prompt mode not enabled or no tools
  if (!options?.prompt || !params?.tools || params.tools.length === 0) {
    return params;
  }

  const framing = options?.framing ?? 'tool';
  const toolChoice = params.toolChoice ?? { type: "auto" as const };

  // Single source of truth for whether constrained decoding will FORCE the tool-call wrapper
  // object. Drives BOTH the injected prompt shape (so the taught example matches) and the
  // responseFormat schema below, so the instruction and the grammar can never diverge.
  const wrapToolCalls = !!options?.structuredToolCalls
    && toolChoice.type === 'required'
    && !params.responseFormat;

  // Create tool instruction prompt with full tool schemas
  const toolPrompt = createToolPrompts(params.tools, toolChoice, framing, wrapToolCalls);

  // Report the resolved framing as an explicit fact, recorded separately from any prompt
  // content. Recording the framing value (not the mere presence of a stored prompt) keeps
  // future prompt-storage changes from silently altering how a turn's framing reads. The
  // injected prompt itself is deliberately NOT recorded: replay reconstructs it from the
  // replay model's own framing/convention, so faithful reproduction comes from modelOverride
  // returning a CC/options.framing model, not from stored prompt telemetry.
  if (options?.onToolFraming) {
    options.onToolFraming({ framing });
  }

  // For a constrained-decoding provider (claude-code) with forced tool use, pin the
  // reply to the tool-call array contour so the rescue parses schema-valid text
  // instead of best-effort free text. The injected prompt above still stands (semantic
  // guidance + prose fallback). Respect a responseFormat a real output schema already
  // set (streamText lowers `output` to params.responseFormat), so never clobber it, and
  // mark that we installed ours so carrier suppression only fires for our schema.
  if (wrapToolCalls) {
    params.responseFormat = { type: 'json', schema: buildToolCallArraySchema(params.tools, framing) };
    (params as any).structuredToolCallsActive = true;
  }

  // Convert existing tool-call/tool-result messages to text so the model
  // sees a consistent text-based history instead of native tool parts it never produced.
  // Pass wrapToolCalls so the echoed prior calls take the SAME wrapper-object shape the
  // injected instruction and responseFormat schema use, instead of a bare array that would
  // contradict them and confuse a weak prompt-mode model.
  let convertedPrompt = convertPromptToolMessagesToText(params.prompt ?? [], framing, wrapToolCalls);

  // Uniformly reword agent-authored system prose to match the action framing.
  // Confined to system messages; the protocol block (toolPrompt) is already
  // action-framed by construction and is inserted below untouched.
  if (framing === 'action') {
    convertedPrompt = convertedPrompt.map(message =>
      message.role === 'system'
        ? { ...message, content: reframeToolWording(message.content) }
        : message
    );
  }

  // Build the modified prompt. Where the protocol block lands depends on framing:
  //  - 'action' (claude-code): insert it right before the first user message, so the
  //    action instructions sit adjacent to the turn the model is asked to act on rather
  //    than buried above the leading system prose. Falls back to the front when the
  //    conversation carries no user message yet (a leading system message is always valid).
  //  - systemPromptFirst models (only accept a single system message at position 0, e.g.
  //    Qwen): merge the tool prompt into the first existing system message.
  //  - otherwise: prepend a new leading system message.
  let modifiedPrompt: LanguageModelV4Prompt;
  if (!toolPrompt) {
    modifiedPrompt = convertedPrompt;
  } else if (framing === 'action') {
    const firstUserIdx = convertedPrompt.findIndex(m => m.role === 'user');
    const insertAt = firstUserIdx === -1 ? 0 : firstUserIdx;
    modifiedPrompt = [
      ...convertedPrompt.slice(0, insertAt),
      { role: 'system', content: toolPrompt },
      ...convertedPrompt.slice(insertAt),
    ];
  } else if (options?.systemPromptFirst && convertedPrompt.length > 0 && convertedPrompt[0].role === 'system') {
    const firstMsg = convertedPrompt[0] as { role: 'system'; content: string };
    modifiedPrompt = [
      { role: 'system', content: toolPrompt + '\n\n' + firstMsg.content },
      ...convertedPrompt.slice(1)
    ];
  } else {
    modifiedPrompt = [
      { role: 'system', content: toolPrompt },
      ...convertedPrompt
    ];
  }

  // Return modified params without tools (since we're using JSON format)
  const newParams: any = params;
  newParams.originalTools = params.tools;
  newParams.tools = undefined;
  newParams.prompt = modifiedPrompt;
  return newParams;
}
