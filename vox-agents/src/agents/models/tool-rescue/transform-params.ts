/**
 * @module agents/models/tool-rescue/transform-params
 *
 * The inbound half of the rescue: teach the model to write tool calls as JSON text, then take its
 * native tools away so it has to.
 *
 * Everything the outbound halves later parse is decided here: the contour the model is shown and
 * the key names in it.
 */

import type { LanguageModelV4CallOptions, LanguageModelV4Prompt } from '@ai-sdk/provider';
import type { ToolRescueOptions } from './types.js';
import {
  createToolPrompts,
  convertPromptToolMessagesToText,
  reframeToolWording,
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

  // Create tool instruction prompt with full tool schemas
  const toolPrompt = createToolPrompts(params.tools, toolChoice, framing);

  // Report the resolved framing as an explicit fact, recorded separately from any prompt
  // content. Recording the framing value (not the mere presence of a stored prompt) keeps
  // future prompt-storage changes from silently altering how a turn's framing reads. The
  // injected prompt itself is deliberately NOT recorded: replay reconstructs it from the
  // replay model's own framing/convention, so faithful reproduction comes from modelOverride
  // returning a model with the matching options.framing, not from stored prompt telemetry.
  if (options?.onToolFraming) {
    options.onToolFraming({ framing });
  }

  // Convert existing tool-call/tool-result messages to text so the model
  // sees a consistent text-based history instead of native tool parts it never produced.
  let convertedPrompt = convertPromptToolMessagesToText(params.prompt ?? [], framing);

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
  //  - 'action' (Oracle prompt-mode replay): insert it right before the first user message,
  //    so the action instructions sit adjacent to the turn the model is asked to act on
  //    rather than buried above the leading system prose. Falls back to the front when the
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
